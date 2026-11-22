import {
  type ApiError,
  AuthenticationError,
  AuthorizationError,
  ClientError,
  ConnectionError,
  InvalidInputError,
  isRecord,
  MalformedResponseError,
  NotFoundError,
  RateLimitError,
  ServerError,
  UncertainWriteError,
  ValidationError,
} from '../errors.js';
import { VERSION } from '../version.js';
import { buildQuery, type QueryValue } from './query.js';
import { isSafeMethod, type RetryOptions, RetryPolicy } from './retry.js';

/** A token, or a function that returns one (for tokens kept in a vault or refreshed elsewhere). */
export type TokenSource = string | (() => string | null | Promise<string | null>) | null;

export interface MopuxOptions {
  /** Your installation, e.g. `https://acme.mopux.com` (a trailing `/api/v1` is accepted). */
  baseUrl: string;
  /** Sanctum personal token (`id|secret`) or OAuth access token. */
  token?: TokenSource;
  /** Timeout of each attempt in ms. Default 30000. */
  timeoutMs?: number;
  /** Retry settings, or a RetryPolicy. Pass `{ maxRetries: 0 }` to disable retries. */
  retry?: RetryOptions | RetryPolicy;
  /** Custom fetch (proxies, instrumentation, tests). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Appended to the SDK User-Agent, e.g. `my-app/1.2`. */
  userAgent?: string;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  /** JSON body; an empty object is sent as `{}`. */
  json?: unknown;
  /** Multipart body (file uploads). */
  form?: FormData;
}

export interface ApiResponse {
  status: number;
  message: string | null;
  data: unknown;
  headers: Headers;
}

/**
 * Sends requests to `/api/v1`, unwraps the `{success, message, data}` envelope and turns
 * error responses into typed errors. Immutable: `withToken()` returns a new connector.
 */
export class Connector {
  readonly baseUrl: string;
  readonly retry: RetryPolicy;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: MopuxOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.retry = options.retry instanceof RetryPolicy ? options.retry : new RetryPolicy(options.retry);
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== 'function') {
      throw new InvalidInputError('fetch', 'no fetch implementation available (Node 24 or later is required).');
    }
    this.fetcher = fetcher;
  }

  withToken(token: TokenSource): Connector {
    return new Connector({ ...this.options, retry: this.retry, token });
  }

  get(path: string, query?: Record<string, QueryValue>): Promise<ApiResponse> {
    return this.request('GET', path, query === undefined ? {} : { query });
  }

  post(path: string, json?: unknown): Promise<ApiResponse> {
    return this.request('POST', path, json === undefined ? {} : { json });
  }

  patch(path: string, json?: unknown): Promise<ApiResponse> {
    return this.request('PATCH', path, json === undefined ? {} : { json });
  }

  delete(path: string, options: RequestOptions = {}): Promise<ApiResponse> {
    return this.request('DELETE', path, options);
  }

  async request(method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse> {
    const upperMethod = method.toUpperCase();
    const cleanPath = path.replace(/^\/+/, '');
    const query = options.query ? buildQuery(options.query) : '';
    const url = `${this.baseUrl}/api/v1/${cleanPath}${query === '' ? '' : `?${query}`}`;
    const headers = await this.headers(options);
    const body = options.form ?? (options.json === undefined ? undefined : JSON.stringify(options.json));

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: upperMethod,
          headers,
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        });
      } catch (error) {
        const delay = this.retry.delayAfterConnectionError(upperMethod, attempt);
        if (delay === null) {
          throw new ConnectionError(upperMethod, cleanPath, error);
        }
        await this.retry.sleep(delay);
        continue;
      }

      if (response.ok) {
        return this.unwrap(upperMethod, cleanPath, response);
      }

      const delay = this.retry.delayAfterResponse(
        upperMethod,
        response.status,
        response.headers.get('retry-after'),
        attempt,
      );
      if (delay !== null) {
        response.body?.cancel().catch(() => {});
        await this.retry.sleep(delay);
        continue;
      }

      throw await mapError(upperMethod, cleanPath, response);
    }
  }

  private async headers(options: RequestOptions): Promise<Headers> {
    const headers = new Headers(this.options.headers);
    headers.set('Accept', 'application/json');
    headers.set(
      'User-Agent',
      `mopux-js/${VERSION} node/${process.versions.node}${this.options.userAgent ? ` ${this.options.userAgent}` : ''}`,
    );
    if (options.json !== undefined && options.form === undefined) {
      headers.set('Content-Type', 'application/json');
    }
    const token = await resolveToken(this.options.token ?? null);
    if (token !== null && token !== '') {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  }

  private async unwrap(method: string, path: string, response: Response): Promise<ApiResponse> {
    const raw = await response.text();
    if (raw.trim() === '') {
      return { status: response.status, message: null, data: null, headers: response.headers };
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new MalformedResponseError(method, path, response.status, raw, 'the body is not JSON');
    }
    if (!isRecord(body) || !('data' in body)) {
      throw new MalformedResponseError(method, path, response.status, raw, 'missing the "data" member');
    }
    return {
      status: response.status,
      message: typeof body.message === 'string' ? body.message : null,
      data: body.data,
      headers: response.headers,
    };
  }
}

async function mapError(method: string, path: string, response: Response): Promise<ApiError> {
  const raw = await response.text().catch(() => '');
  let body: unknown = null;
  try {
    body = raw.trim() === '' ? null : JSON.parse(raw);
  } catch {
    body = null;
  }
  const status = response.status;
  const isWrite = !isSafeMethod(method);
  const ErrorClass =
    status === 401
      ? AuthenticationError
      : status === 403
        ? AuthorizationError
        : status === 404
          ? NotFoundError
          : status === 422
            ? ValidationError
            : status === 429
              ? RateLimitError
              : status >= 500
                ? isWrite
                  ? UncertainWriteError
                  : ServerError
                : ClientError;

  let message = errorMessage(status, response.statusText, body);
  if (ErrorClass === UncertainWriteError) {
    message += ' The write outcome is uncertain: refresh the state before retrying.';
  }

  return new ErrorClass(message, status, method, path, body, response.headers);
}

/**
 * The API message followed by the details it carries elsewhere: `data.error` when it adds
 * something and, for 422, the field errors not already in the message.
 */
function errorMessage(status: number, statusText: string, body: unknown): string {
  const data = isRecord(body) && isRecord(body.data) ? body.data : {};
  const error = typeof data.error === 'string' && data.error.trim() !== '' ? data.error.trim() : null;
  let message = isRecord(body) && typeof body.message === 'string' ? body.message.trim() : '';
  if (message === '') {
    message = error ?? (statusText || 'Mopux API error');
  }
  const details = status === 422 ? validationMessages(data.errors) : error === null ? [] : [error];
  for (const detail of new Set(details)) {
    if (!message.includes(detail)) {
      message += ` ${detail}`;
    }
  }
  return `${message} (HTTP ${status})`;
}

function validationMessages(errors: unknown): string[] {
  const messages: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string' && value.trim() !== '') {
      messages.push(value.trim());
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (isRecord(value)) {
      Object.values(value).forEach(walk);
    }
  };
  walk(errors);
  return messages;
}

async function resolveToken(token: TokenSource): Promise<string | null> {
  return typeof token === 'function' ? await token() : token;
}

function normalizeBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new InvalidInputError('baseUrl', `"${baseUrl}" is not a valid URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InvalidInputError('baseUrl', 'must use http or https.');
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return `${url.origin}${path}`;
}
