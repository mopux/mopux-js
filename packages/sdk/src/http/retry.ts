import { InvalidInputError, parseRetryAfter } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface RetryOptions {
  /** Retries after the first attempt (0 disables retries). Default 2. */
  maxRetries?: number;
  /** First backoff delay in ms; doubles on every retry, with up to 25% jitter. Default 250. */
  baseDelayMs?: number;
  /** Upper bound of the backoff delay in ms. Default 5000. */
  maxDelayMs?: number;
  /** A longer `Retry-After` is not waited for: the RateLimitError is thrown. Default 60. */
  maxRetryAfterSeconds?: number;
  /** Receives milliseconds. Defaults to a timer; tests can pass a no-op. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Reads are retried on network errors and 5xx; any method is retried on 429 when the API says
 * how long to wait. Writes are never retried after a network error or a 5xx: their outcome is
 * uncertain and repeating them could duplicate data.
 */
export class RetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxRetryAfterSeconds: number;
  private readonly sleeper: (milliseconds: number) => Promise<void>;

  constructor(options: RetryOptions = {}) {
    this.maxRetries = options.maxRetries ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 250;
    this.maxDelayMs = options.maxDelayMs ?? 5_000;
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 60;
    for (const [field, value] of Object.entries({
      maxRetries: this.maxRetries,
      baseDelayMs: this.baseDelayMs,
      maxDelayMs: this.maxDelayMs,
      maxRetryAfterSeconds: this.maxRetryAfterSeconds,
    })) {
      if (!Number.isInteger(value) || value < 0) {
        throw new InvalidInputError(`retry.${field}`, 'must be a non-negative integer.');
      }
    }
    this.sleeper = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  static none(): RetryPolicy {
    return new RetryPolicy({ maxRetries: 0 });
  }

  /** Delay before retrying after a network error, or null to give up. */
  delayAfterConnectionError(method: string, attempt: number): number | null {
    if (attempt >= this.maxRetries || !SAFE_METHODS.has(method.toUpperCase())) {
      return null;
    }
    return this.backoff(attempt);
  }

  /** Delay before retrying after an HTTP response, or null to give up. */
  delayAfterResponse(method: string, status: number, retryAfter: string | null, attempt: number): number | null {
    if (attempt >= this.maxRetries) {
      return null;
    }
    if (status === 429) {
      const seconds = parseRetryAfter(retryAfter);
      if (seconds === null) {
        return this.backoff(attempt);
      }
      return seconds <= this.maxRetryAfterSeconds ? seconds * 1000 : null;
    }
    if (status >= 500 && SAFE_METHODS.has(method.toUpperCase())) {
      return this.backoff(attempt);
    }
    return null;
  }

  async sleep(milliseconds: number): Promise<void> {
    if (milliseconds > 0) {
      await this.sleeper(milliseconds);
    }
  }

  private backoff(attempt: number): number {
    const delay = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
    return Math.min(this.maxDelayMs, delay + Math.floor(Math.random() * (Math.floor(delay / 4) + 1)));
  }
}

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}
