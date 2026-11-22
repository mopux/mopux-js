/**
 * Every error thrown by the SDK extends MopuxError, so `catch (e) { if (e instanceof MopuxError) … }`
 * covers network failures, API errors, malformed responses and invalid input.
 */
export class MopuxError extends Error {
  override name = 'MopuxError';
}

/** The request never got an HTTP response (DNS, TLS, timeout, connection reset…). */
export class ConnectionError extends MopuxError {
  override name = 'ConnectionError';

  constructor(
    readonly method: string,
    readonly path: string,
    override readonly cause: unknown,
  ) {
    super(`Could not reach the Mopux API (${method} ${path}): ${describe(cause)}`, { cause });
  }

  /**
   * True for writes: the request may have reached the API before the connection failed, so the
   * change may have been applied. Check the current state before sending it again.
   */
  get isWriteOutcomeUncertain(): boolean {
    return !['GET', 'HEAD', 'OPTIONS'].includes(this.method.toUpperCase());
  }
}

/** The API answered with a non-2xx status. */
export class ApiError extends MopuxError {
  override name = 'ApiError';

  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly path: string,
    /** Decoded JSON body, or null when the body was not JSON. */
    readonly body: unknown,
    readonly headers: Headers = new Headers(),
  ) {
    super(message);
  }

  /** Stable machine code from `data.code` (e.g. `plan_feature_unavailable`), when the API sends one. */
  get code(): string | null {
    const code = dataOf(this.body)?.code;
    return typeof code === 'string' ? code : null;
  }

  /** The API message (`message`, or `data.error` when there is no message). */
  get apiMessage(): string | null {
    if (isRecord(this.body) && typeof this.body.message === 'string' && this.body.message.trim() !== '') {
      return this.body.message;
    }
    const error = dataOf(this.body)?.error;
    return typeof error === 'string' ? error : null;
  }
}

/** 401: missing, invalid, revoked or expired token. Log in again. */
export class AuthenticationError extends ApiError {
  override name = 'AuthenticationError';
}

/** 403: no permission, missing OAuth scope, plan restriction or blocked billing. */
export class AuthorizationError extends ApiError {
  override name = 'AuthorizationError';

  /** The installation plan does not include the feature (`data.code = plan_feature_unavailable`). */
  isPlanRestriction(): boolean {
    return this.code === 'plan_feature_unavailable';
  }

  /** The feature the plan lacks (`data.feature`, e.g. `api`), when the error is a plan restriction. */
  get planFeature(): string | null {
    const feature = dataOf(this.body)?.feature;
    return this.isPlanRestriction() && typeof feature === 'string' ? feature : null;
  }

  /** The installation billing is blocked (`data.code = billing_access_blocked`). */
  isBillingBlocked(): boolean {
    return this.code === 'billing_access_blocked';
  }
}

export class NotFoundError extends ApiError {
  override name = 'NotFoundError';
}

/** 422: the API rejected the input. */
export class ValidationError extends ApiError {
  override name = 'ValidationError';

  /** Messages per field, from `data.errors`. */
  get errors(): Record<string, string[]> {
    const errors = dataOf(this.body)?.errors;
    if (!isRecord(errors)) {
      return {};
    }
    const result: Record<string, string[]> = {};
    for (const [field, messages] of Object.entries(errors)) {
      result[field] = (Array.isArray(messages) ? messages : [messages]).filter(
        (message): message is string => typeof message === 'string',
      );
    }
    return result;
  }
}

/** 429: too many requests. */
export class RateLimitError extends ApiError {
  override name = 'RateLimitError';

  /** Seconds to wait, from `Retry-After`, or null when the header is missing or invalid. */
  get retryAfter(): number | null {
    return parseRetryAfter(this.headers.get('retry-after'));
  }
}

/** 5xx on a read request. Safe to retry later. */
export class ServerError extends ApiError {
  override name = 'ServerError';
}

/**
 * 5xx on a write request (POST, PATCH, DELETE). The change may or may not have been applied:
 * read the current state before trying again. The SDK never retries writes.
 */
export class UncertainWriteError extends ApiError {
  override name = 'UncertainWriteError';
}

/** Any other 4xx (400, 405, 409, 413…). */
export class ClientError extends ApiError {
  override name = 'ClientError';
}

/** The API answered 2xx with a body the SDK cannot understand. */
export class MalformedResponseError extends MopuxError {
  override name = 'MalformedResponseError';

  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly rawBody: string,
    reason: string,
  ) {
    super(`Malformed response from the Mopux API (${method} ${path}, HTTP ${status}): ${reason}`);
  }
}

/** The SDK rejected an argument before sending the request. */
export class InvalidInputError extends MopuxError {
  override name = 'InvalidInputError';

  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`Invalid ${field}: ${reason}`);
  }
}

export function parseRetryAfter(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dataOf(body: unknown): Record<string, unknown> | null {
  return isRecord(body) && isRecord(body.data) ? body.data : null;
}

function describe(cause: unknown): string {
  if (cause instanceof Error) {
    const inner = cause.cause instanceof Error ? ` (${cause.cause.message})` : '';
    return `${cause.message}${inner}`;
  }
  return String(cause);
}
