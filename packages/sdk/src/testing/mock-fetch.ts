export interface RecordedRequest {
  method: string;
  url: URL;
  /** Path relative to `/api/v1/`, e.g. `tasks/12`. */
  path: string;
  headers: Headers;
  /** Parsed JSON body, the FormData of a multipart body, or null. */
  body: unknown;
}

type Responder = Response | Error | ((request: RecordedRequest) => Response | Error | Promise<Response | Error>);

/**
 * A fetch replacement that answers from a queue and records every request.
 *
 * ```ts
 * const mock = new MockFetch().push(MockFetch.json({ id: 12, title: 'Web' }));
 * const mopux = new Mopux({ baseUrl: 'https://acme.test', token: 't', fetch: mock.fetch });
 * await mopux.projects.show(12);
 * mock.assertSent('GET', 'projects/12');
 * ```
 */
export class MockFetch {
  readonly requests: RecordedRequest[] = [];
  private readonly queue: Responder[] = [];
  private fallback: Responder | null = null;

  /** Bound fetch to pass as the `fetch` option. */
  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const contentType = request.headers.get('content-type') ?? '';
    let body: unknown = null;
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else if (contentType.includes('multipart/form-data')) {
      body = await request.formData();
    }
    const recorded: RecordedRequest = {
      method: request.method,
      url,
      path: url.pathname.replace(/^.*?\/api\/v1\//, ''),
      headers: request.headers,
      body,
    };
    this.requests.push(recorded);

    const responder = this.queue.shift() ?? this.fallback;
    if (responder === null) {
      throw new Error(`MockFetch: no response queued for ${recorded.method} ${recorded.path}`);
    }
    const result = typeof responder === 'function' ? await responder(recorded) : responder;
    if (result instanceof Error) {
      throw result;
    }
    return result.clone();
  };

  /** Queues responses (or errors to simulate network failures), answered in order. */
  push(...responders: Responder[]): this {
    this.queue.push(...responders);
    return this;
  }

  /** Answers every request without a queued response. */
  always(responder: Responder): this {
    this.fallback = responder;
    return this;
  }

  /** A success response with the Mopux envelope. */
  static json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ success: true, message: 'OK', data }), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }

  /** An error response with the Mopux envelope. */
  static error(
    status: number,
    message: string,
    data: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ): Response {
    return new Response(JSON.stringify({ success: false, message, data: { error: message, ...data } }), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }

  /** 403 returned when the installation plan does not include a feature. */
  static planRestricted(feature = 'api'): Response {
    return MockFetch.error(403, 'The plan of this installation does not include this feature.', {
      code: 'plan_feature_unavailable',
      feature,
    });
  }

  /** 422 with field errors. */
  static validation(errors: Record<string, string[]>): Response {
    return MockFetch.error(422, 'The given data was invalid.', { errors });
  }

  /** A network failure. */
  static networkError(message = 'fetch failed'): TypeError {
    return new TypeError(message);
  }

  /** Throws unless a request with this method and path (relative to `/api/v1/`) was sent. */
  assertSent(method: string, path: string, match?: (request: RecordedRequest) => boolean): RecordedRequest {
    const found = this.requests.find(
      (request) =>
        request.method === method.toUpperCase() && request.path === path && (match === undefined || match(request)),
    );
    if (found === undefined) {
      const sent = this.requests.map((request) => `${request.method} ${request.path}`).join(', ') || 'none';
      throw new Error(`MockFetch: expected ${method.toUpperCase()} ${path} to be sent. Sent: ${sent}`);
    }
    return found;
  }

  assertNothingSent(): void {
    if (this.requests.length > 0) {
      throw new Error(`MockFetch: expected no requests, ${this.requests.length} sent.`);
    }
  }
}
