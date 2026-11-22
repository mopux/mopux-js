import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  AuthorizationError,
  ClientError,
  ConnectionError,
  InvalidInputError,
  MalformedResponseError,
  Mopux,
  NotFoundError,
  Page,
  RateLimitError,
  RetryPolicy,
  ServerError,
  UncertainWriteError,
  Upload,
  ValidationError,
} from '../../src/index.js';
import { MockFetch } from '../../src/testing/index.js';

function client(mock: MockFetch, retry: RetryPolicy | object = { sleep: async () => {} }): Mopux {
  return new Mopux({ baseUrl: 'https://acme.mopux.test/api/v1/', token: '1|secret', fetch: mock.fetch, retry });
}

describe('requests', () => {
  it('sends the token, JSON headers and the SDK user agent, and unwraps data', async () => {
    const mock = new MockFetch().push(MockFetch.json({ id: 12, title: 'Web' }));
    const project = await client(mock).projects.show(12);

    expect(project).toEqual({ id: 12, title: 'Web' });
    const request = mock.assertSent('GET', 'projects/12');
    expect(request.url.origin).toBe('https://acme.mopux.test');
    expect(request.headers.get('authorization')).toBe('Bearer 1|secret');
    expect(request.headers.get('accept')).toBe('application/json');
    expect(request.headers.get('user-agent')).toMatch(/^mopux-js\/\d+\.\d+\.\d+ node\//);
  });

  it('accepts a token function and builds Laravel-style queries', async () => {
    const mock = new MockFetch().push(MockFetch.json([]));
    const mopux = new Mopux({ baseUrl: 'https://acme.test', token: async () => 'from-vault', fetch: mock.fetch });

    await mopux.tasks.my({ search: 'web', projectIds: [3, 4] });

    const request = mock.assertSent('GET', 'tasks/my');
    expect(request.headers.get('authorization')).toBe('Bearer from-vault');
    expect(decodeURIComponent(request.url.search)).toBe('?search=web&params[projects][]=3&params[projects][]=4');
  });

  it('sends booleans as 1/0 and leaves out undefined filters', async () => {
    const mock = new MockFetch().push(MockFetch.json({ id: 12, task_groups: [] }));
    await client(mock).projects.board(12, { statuses: [0, 1] });

    expect(decodeURIComponent(mock.requests[0]?.url.search ?? '')).toBe(
      '?archived=0&params[status][]=0&params[status][]=1',
    );
  });

  it('keeps null in JSON bodies so the API clears the value', async () => {
    const mock = new MockFetch().push(MockFetch.json({ id: 101 }));
    await client(mock).tasks.update(101, { description: null, assignees: { operation: 'replace', user_ids: [] } });

    expect(mock.requests[0]?.body).toEqual({ description: null, assignees: { operation: 'replace', user_ids: [] } });
  });

  it('normalizes hours and validates input before sending anything', async () => {
    const mock = new MockFetch().always(MockFetch.json({ id: 101 }));
    const mopux = client(mock);

    await mopux.tasks.updateHours(101, { expected: 90, inverted: null });
    expect(mock.requests[0]?.body).toEqual({ hours_expected: '01:30', hours_inverted: null });

    await expect(mopux.tasks.updateHours(101, { expected: '1:75' })).rejects.toThrow(InvalidInputError);
    await expect(mopux.tasks.updateStatus(101, -1 as never)).rejects.toThrow(InvalidInputError);
    await expect(mopux.tasks.updateStart(101, '2026-02-30')).rejects.toThrow(InvalidInputError);
    await expect(mopux.projects.show(0)).rejects.toThrow(InvalidInputError);
    await expect(mopux.comments.create(101, '   ')).rejects.toThrow(InvalidInputError);
    expect(mock.requests).toHaveLength(1);
  });

  it('rejects an invalid base URL', () => {
    expect(() => new Mopux({ baseUrl: 'acme.mopux.com' })).toThrow(InvalidInputError);
  });
});

describe('errors', () => {
  it.each([
    [401, AuthenticationError],
    [403, AuthorizationError],
    [404, NotFoundError],
    [409, ClientError],
    [422, ValidationError],
  ])('maps HTTP %i', async (status, ErrorClass) => {
    const mock = new MockFetch().push(MockFetch.error(status, 'Nope'));
    const error = await client(mock)
      .projects.show(12)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorClass);
    expect(error).toMatchObject({ status, method: 'GET', path: 'projects/12' });
  });

  it('exposes the plan restriction and the field errors', async () => {
    const mock = new MockFetch().push(
      MockFetch.planRestricted('api'),
      MockFetch.validation({ title: ['The title field is required.'] }),
    );
    const mopux = client(mock);

    const plan = (await mopux.tasks.my().catch((e: unknown) => e)) as AuthorizationError;
    expect(plan.isPlanRestriction()).toBe(true);
    expect(plan.planFeature).toBe('api');
    expect(plan.isBillingBlocked()).toBe(false);
    expect(plan.code).toBe('plan_feature_unavailable');

    const invalid = (await mopux.tasks.updateTitle(101, 'x').catch((e: unknown) => e)) as ValidationError;
    expect(invalid.errors).toEqual({ title: ['The title field is required.'] });
    expect(invalid.message).toContain('The title field is required.');
    expect(invalid.message).toContain('(HTTP 422)');
  });

  it('throws UncertainWriteError on a 5xx write and never retries it', async () => {
    const mock = new MockFetch().always(MockFetch.error(500, 'Server Error.'));
    const error = await client(mock)
      .tasks.create({ project_id: 1, group_id: 2, title: 'x' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UncertainWriteError);
    expect((error as Error).message).toContain('outcome is uncertain');
    expect(mock.requests).toHaveLength(1);
  });

  it('does not retry a write after a network error', async () => {
    const mock = new MockFetch().always(MockFetch.networkError());
    const error = await client(mock)
      .tasks.delete(101)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).isWriteOutcomeUncertain).toBe(true);
    expect(mock.requests).toHaveLength(1);
  });

  it('rejects a 2xx body that is not the Mopux envelope', async () => {
    const mock = new MockFetch().push(new Response('<html>', { status: 200 }));
    await expect(client(mock).projects.show(1)).rejects.toThrow(MalformedResponseError);
  });
});

describe('retries', () => {
  it('retries reads after 5xx and network errors with backoff', async () => {
    const delays: number[] = [];
    const mock = new MockFetch().push(
      MockFetch.error(503, 'Unavailable'),
      MockFetch.networkError(),
      MockFetch.json({ id: 12 }),
    );
    const retry = new RetryPolicy({ maxRetries: 2, sleep: async (ms) => void delays.push(ms) });

    await expect(client(mock, retry).projects.show(12)).resolves.toEqual({ id: 12 });
    expect(mock.requests).toHaveLength(3);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(250);
    expect(delays[1]).toBeGreaterThanOrEqual(500);
  });

  it('gives up after maxRetries with the mapped error', async () => {
    const mock = new MockFetch().always(MockFetch.error(502, 'Bad gateway'));
    await expect(
      client(mock, new RetryPolicy({ maxRetries: 1, sleep: async () => {} })).projects.show(1),
    ).rejects.toThrow(ServerError);
    expect(mock.requests).toHaveLength(2);
  });

  it('waits Retry-After on 429, also for writes, but not when it is too long', async () => {
    const delays: number[] = [];
    const retry = new RetryPolicy({ sleep: async (ms) => void delays.push(ms) });
    const mock = new MockFetch().push(
      MockFetch.error(429, 'Too Many Attempts.', {}, { 'Retry-After': '3' }),
      MockFetch.json({ id: 1 }),
      MockFetch.error(429, 'Too Many Attempts.', {}, { 'Retry-After': '120' }),
    );
    const mopux = client(mock, retry);

    await mopux.tasks.updateTitle(1, 'x');
    expect(delays).toEqual([3000]);

    const error = (await mopux.tasks.updateTitle(1, 'y').catch((e: unknown) => e)) as RateLimitError;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfter).toBe(120);
  });
});

describe('pagination', () => {
  it('reads Laravel pagination and iterates every page lazily', async () => {
    const page = (items: number[], current: number, last: number) =>
      MockFetch.json({
        data: items.map((id) => ({ id })),
        links: {},
        meta: { current_page: current, last_page: last, per_page: 2, total: 3 },
      });
    const mock = new MockFetch().push(page([1, 2], 1, 2), page([3], 2, 2));
    const mopux = client(mock);

    const ids: number[] = [];
    for await (const project of mopux.projects.iterate({ perPage: 2 })) {
      ids.push(project.id ?? 0);
    }

    expect(ids).toEqual([1, 2, 3]);
    expect(mock.requests.map((r) => r.url.searchParams.get('page'))).toEqual(['1', '2']);
  });

  it('accepts the plain list of API 1.1 for comments and stops at a short page', async () => {
    const mock = new MockFetch().push(MockFetch.json([{ id: 1 }, { id: 2 }]), MockFetch.json([{ id: 3 }]));
    const ids: number[] = [];
    for await (const comment of client(mock).comments.iterate(101, { perPage: 2 })) {
      ids.push(comment.id ?? 0);
    }

    expect(ids).toEqual([1, 2, 3]);
    expect(mock.requests).toHaveLength(2);
  });

  it('reads page fields inside the object (team, attachments)', async () => {
    const mock = new MockFetch().push(MockFetch.json({ members: [{ id: 5 }], page: 1, last_page: 3, total: 51 }));
    const team = await client(mock).team.list({ perPage: 25 });

    expect(team).toBeInstanceOf(Page);
    expect(team.items).toEqual([{ id: 5 }]);
    expect(team.total).toBe(51);
    expect(team.nextPage()).toBe(2);
  });
});

describe('uploads and login', () => {
  it('sends comments with files as multipart with bracketed array names', async () => {
    const mock = new MockFetch().push(MockFetch.json({ id: 9 }));
    await client(mock).comments.create(101, {
      comment: 'See attached',
      mentions: [5, 6],
      files: [Upload.from('hello', 'notes.txt', 'text/plain')],
    });

    const form = mock.assertSent('POST', 'tasks/101/comments').body as FormData;
    expect(form.get('comment')).toBe('See attached');
    expect(form.getAll('mentions[]')).toEqual(['5', '6']);
    const file = form.get('files[]') as File;
    expect(file.name).toBe('notes.txt');
    expect(await file.text()).toBe('hello');
  });

  it('logs in and returns a client that uses the new token', async () => {
    const mock = new MockFetch().push(
      MockFetch.json({ token_type: 'Bearer', token: '7|new', user: { id: 1 } }),
      MockFetch.json({ user: { id: 1, name: 'Ada' } }),
    );
    const mopux = await Mopux.login({
      baseUrl: 'https://acme.test',
      email: 'ada@acme.test',
      password: 'pw',
      tokenName: 'cli',
      fetch: mock.fetch,
    });

    expect(mopux.token).toBe('7|new');
    expect(mock.requests[0]?.headers.get('authorization')).toBeNull();
    expect(mock.requests[0]?.body).toEqual({ email: 'ada@acme.test', password: 'pw', token_name: 'cli' });
    await expect(mopux.auth.user()).resolves.toEqual({ id: 1, name: 'Ada' });
    expect(mock.requests[1]?.headers.get('authorization')).toBe('Bearer 7|new');
  });

  it('returns the group with its tasks when created with tasks, and an empty list without them', async () => {
    const mock = new MockFetch().push(
      MockFetch.json({ group: { id: 7, title: 'Sprint' }, tasks: [{ id: 101 }] }),
      MockFetch.json({ id: 8, title: 'Empty' }),
    );
    const mopux = client(mock);

    await expect(mopux.taskGroups.create(12, 'Sprint', [{ title: 'First' }])).resolves.toEqual({
      id: 7,
      title: 'Sprint',
      tasks: [{ id: 101 }],
    });
    await expect(mopux.taskGroups.create(12, 'Empty')).resolves.toEqual({ id: 8, title: 'Empty', tasks: [] });
  });
});
