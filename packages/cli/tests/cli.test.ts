import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockFetch } from '@mopux/sdk/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/app.js';
import type { Io } from '../src/context.js';
import { FileTokenStore } from '../src/credentials.js';

interface Harness {
  dir: string;
  mock: MockFetch;
  out: string[];
  err: string[];
  answers: string[];
  stdin: string;
  exec(...argv: string[]): Promise<number>;
}

let h: Harness;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mopux-cli-'));
  const harness: Harness = {
    dir,
    mock: new MockFetch(),
    out: [],
    err: [],
    answers: [],
    stdin: '',
    exec: async (...argv) => {
      const io: Io = {
        stdout: (text) => harness.out.push(text),
        stderr: (text) => harness.err.push(text),
        readStdin: async () => harness.stdin,
        prompt: async () => harness.answers.shift() ?? '',
        interactive: true,
      };
      return run(argv, {
        io,
        env: { MOPUX_CONFIG_DIR: dir },
        tokenStore: new FileTokenStore(dir),
        fetch: harness.mock.fetch,
      });
    },
  };
  h = harness;
});

const output = (): string => h.out.join('');
const errors = (): string => h.err.join('');

async function loggedIn(): Promise<void> {
  h.answers.push('secret');
  h.mock.push(MockFetch.json({ token_type: 'Bearer', token: '7|abc', user: { id: 1 } }));
  expect(await h.exec('login', 'acme.mopux.test', '--email', 'ada@acme.test')).toBe(0);
  h.out.length = 0;
}

describe('login and profiles', () => {
  it('logs in, saves the profile without secrets and the token with permissions 600', async () => {
    await loggedIn();

    const login = h.mock.assertSent('POST', 'auth/login');
    expect(login.url.origin).toBe('https://acme.mopux.test');
    expect(login.body).toMatchObject({ email: 'ada@acme.test', password: 'secret' });
    expect((login.body as { token_name: string }).token_name).toMatch(/^mopux-cli@/);

    const config = JSON.parse(await readFile(join(h.dir, 'config.json'), 'utf8'));
    expect(config).toEqual({
      defaultProfile: 'acme',
      profiles: { acme: { url: 'https://acme.mopux.test', storage: 'file', email: 'ada@acme.test' } },
    });
    expect(JSON.stringify(config)).not.toContain('7|abc');
    expect(JSON.parse(await readFile(join(h.dir, 'credentials.json'), 'utf8'))).toEqual({ acme: '7|abc' });
    expect((await stat(join(h.dir, 'credentials.json'))).mode & 0o777).toBe(0o600);
  });

  it('logs in with a token from stdin for scripts and checks it', async () => {
    h.stdin = '9|from-ci\n';
    h.mock.push(MockFetch.json({ user: { id: 2, name: 'Bot', email: 'bot@acme.test' } }));

    expect(await h.exec('login', 'https://beta.mopux.test', '--with-token', '--profile', 'ci', '--json')).toBe(0);

    expect(h.mock.assertSent('GET', 'auth/user').headers.get('authorization')).toBe('Bearer 9|from-ci');
    expect(JSON.parse(output())).toEqual({
      profile: 'ci',
      url: 'https://beta.mopux.test',
      email: 'bot@acme.test',
      storage: 'file',
    });
  });

  it('lists, switches and removes profiles', async () => {
    await loggedIn();
    h.stdin = '9|x';
    h.mock.push(MockFetch.json({ user: { id: 2, email: 'bot@acme.test' } }));
    await h.exec('login', 'beta.mopux.test', '--with-token');
    h.out.length = 0;

    await h.exec('profiles');
    expect(output()).toMatch(/\*\s+acme\s+https:\/\/acme\.mopux\.test/);
    expect(output()).toMatch(/beta\s+https:\/\/beta\.mopux\.test/);

    expect(await h.exec('profiles', 'use', 'beta')).toBe(0);
    expect(JSON.parse(await readFile(join(h.dir, 'config.json'), 'utf8')).defaultProfile).toBe('beta');

    expect(await h.exec('profiles', 'remove', 'beta')).toBe(0);
    const config = JSON.parse(await readFile(join(h.dir, 'config.json'), 'utf8'));
    expect(config.defaultProfile).toBe('acme');
    expect(Object.keys(config.profiles)).toEqual(['acme']);
  });

  it('logs out: revokes the token and forgets it', async () => {
    await loggedIn();
    h.mock.push(MockFetch.json([]));

    expect(await h.exec('logout')).toBe(0);
    expect(h.mock.assertSent('POST', 'auth/logout').headers.get('authorization')).toBe('Bearer 7|abc');
    expect(JSON.parse(await readFile(join(h.dir, 'credentials.json'), 'utf8'))).toEqual({});
  });

  it('asks to log in when there is no session', async () => {
    expect(await h.exec('tasks', 'my')).toBe(3);
    expect(errors()).toContain('mopux login');
    h.mock.assertNothingSent();
  });
});

describe('commands', () => {
  beforeEach(loggedIn);

  it('prints my tasks as a table and as JSON', async () => {
    const tasks = [
      {
        id: 101,
        title: 'Write docs',
        status: 1,
        priority: 2,
        date_end: '2026-12-01',
        project: { id: 3, title: 'Web' },
      },
    ];
    h.mock.push(MockFetch.json(tasks), MockFetch.json(tasks));

    expect(await h.exec('tasks', 'my', '--project', '3')).toBe(0);
    expect(output()).toMatch(/ID\s+Status\s+Priority\s+End\s+Project\s+Title/);
    expect(output()).toMatch(/101\s+In progress\s+High\s+2026-12-01\s+Web\s+Write docs/);
    expect(decodeURIComponent(h.mock.requests.at(-1)?.url.search ?? '')).toBe('?params[projects][]=3');

    h.out.length = 0;
    expect(await h.exec('tasks', 'my', '--json')).toBe(0);
    expect(JSON.parse(output())).toEqual(tasks);
  });

  it('creates a task with words for priority and repeated options', async () => {
    h.mock.push(MockFetch.json({ id: 202, title: 'Deploy' }));

    expect(
      await h.exec(
        'task',
        'create',
        '--project',
        '3',
        '--group',
        '7',
        '--title',
        'Deploy',
        '--priority',
        'max',
        '--hours',
        '1:30',
        '--assign',
        '5',
        '--assign',
        '6',
        '--end',
        '2026-12-31',
      ),
    ).toBe(0);

    expect(h.mock.assertSent('POST', 'tasks').body).toEqual({
      project_id: 3,
      group_id: 7,
      title: 'Deploy',
      priority: 9,
      hours_expected: '01:30',
      assignees: [5, 6],
      date_end: '2026-12-31',
    });
    expect(output()).toContain('Created task #202');
  });

  it('changes the status with a word', async () => {
    h.mock.push(MockFetch.json({ id: 101, status: 3 }));
    expect(await h.exec('task', 'status', '101', 'done')).toBe(0);
    expect(h.mock.assertSent('PATCH', 'tasks/101/status').body).toEqual({ status: 3 });
    expect(output()).toContain('Task #101 is now Done.');
  });

  it('comments with a file as multipart', async () => {
    const file = join(h.dir, 'notes.txt');
    await writeFile(file, 'hello');
    h.mock.push(MockFetch.json({ id: 55 }));

    expect(await h.exec('task', 'comment', '101', 'See', 'attached', '--file', file)).toBe(0);

    const form = h.mock.assertSent('POST', 'tasks/101/comments').body as FormData;
    expect(form.get('comment')).toBe('See attached');
    expect((form.get('files[]') as File).name).toBe('notes.txt');
  });

  it('shows the board grouped by task group', async () => {
    h.mock.push(
      MockFetch.json({
        id: 3,
        title: 'Web',
        task_groups: [
          {
            id: 7,
            title: 'Backlog',
            status: 0,
            position: 1,
            tasks: [{ id: 101, title: 'Docs', status: 0, priority: 1, assignees: [{ id: 5, name: 'Ada' }] }],
          },
        ],
      }),
    );
    expect(await h.exec('board', '3')).toBe(0);
    expect(output()).toContain('Backlog (#7): 1 open');
    expect(output()).toMatch(/101\s+Pending\s+Normal\s+Ada\s+Docs/);
    expect(decodeURIComponent(h.mock.requests.at(-1)?.url.search ?? '')).toBe('?archived=0');
  });

  it('explains API errors with exit codes', async () => {
    h.mock.push(
      MockFetch.planRestricted('api'),
      MockFetch.error(401, 'Unauthenticated.'),
      MockFetch.validation({ title: ['The title field is required.'] }),
      MockFetch.error(500, 'Server Error.'),
    );

    expect(await h.exec('tasks', 'my')).toBe(4);
    expect(errors()).toContain('does not include the API');
    expect(await h.exec('whoami')).toBe(3);
    expect(errors()).toContain('Run "mopux login" again');
    expect(await h.exec('task', 'status', '1', 'done')).toBe(1);
    expect(errors()).toContain('title: The title field is required.');
    expect(await h.exec('task', 'create', '--project', '1', '--group', '2', '--title', 'x')).toBe(1);
    expect(errors()).toContain('may have been applied');
    expect(h.mock.requests.filter((request) => request.method === 'POST' && request.path === 'tasks')).toHaveLength(1);
  });

  it('rejects wrong usage before calling the API', async () => {
    const before = h.mock.requests.length;
    expect(await h.exec('task', 'status', '101', 'finished')).toBe(2);
    expect(errors()).toContain('Unknown status "finished"');
    expect(await h.exec('task', 'create', '--project', '3')).toBe(2);
    expect(await h.exec('tasks', 'my', '--nope')).toBe(2);
    expect(await h.exec('task', 'nope')).toBe(2);
    expect(errors()).toContain('Available: task show, task create');
    expect(h.mock.requests.length).toBe(before);
  });
});

describe('help and environment', () => {
  it('prints help and version', async () => {
    expect(await h.exec('--help')).toBe(0);
    expect(output()).toContain('tasks my');
    h.out.length = 0;
    expect(await h.exec('task', 'create', '--help')).toBe(0);
    expect(output()).toContain('Usage: mopux task create --project');
    h.out.length = 0;
    expect(await h.exec('--version')).toBe(0);
    expect(output().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('uses MOPUX_URL and MOPUX_TOKEN without a profile', async () => {
    h.mock.push(MockFetch.json({ user: { id: 1, name: 'Ada', email: 'ada@acme.test' } }));
    const io: Io = {
      stdout: (text) => h.out.push(text),
      stderr: (text) => h.err.push(text),
      readStdin: async () => '',
      prompt: async () => '',
      interactive: false,
    };
    const code = await run(['whoami'], {
      io,
      env: { MOPUX_CONFIG_DIR: h.dir, MOPUX_URL: 'https://ci.mopux.test', MOPUX_TOKEN: '3|ci' },
      tokenStore: new FileTokenStore(h.dir),
      fetch: h.mock.fetch,
    });

    expect(code).toBe(0);
    expect(h.mock.assertSent('GET', 'auth/user').url.origin).toBe('https://ci.mopux.test');
    expect(output()).toContain('Ada <ada@acme.test>');
  });
});
