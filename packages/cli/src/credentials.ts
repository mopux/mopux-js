import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readJson, writePrivateJson } from './config.js';

export interface TokenStore {
  readonly kind: 'keychain' | 'file';
  get(profile: string, url: string): Promise<string | null>;
  set(profile: string, url: string, token: string): Promise<void>;
  delete(profile: string, url: string): Promise<void>;
}

const SERVICE = 'mopux-cli';

/** Tokens in `credentials.json` (permissions 600), keyed by profile. */
export class FileTokenStore implements TokenStore {
  readonly kind = 'file' as const;

  constructor(private readonly dir: string) {}

  private get path(): string {
    return join(this.dir, 'credentials.json');
  }

  async get(profile: string): Promise<string | null> {
    const tokens = await readJson<Record<string, string>>(this.path, {});
    return tokens[profile] ?? null;
  }

  async set(profile: string, _url: string, token: string): Promise<void> {
    const tokens = await readJson<Record<string, string>>(this.path, {});
    tokens[profile] = token;
    await writePrivateJson(this.path, tokens);
  }

  async delete(profile: string): Promise<void> {
    const tokens = await readJson<Record<string, string>>(this.path, {});
    if (profile in tokens) {
      delete tokens[profile];
      await writePrivateJson(this.path, tokens);
    }
  }
}

interface CommandResult {
  code: number;
  stdout: string;
}

function run(command: string, args: string[], input?: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve({ code: 127, stdout: '' });
      return;
    }
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => resolve({ code: 127, stdout: '' }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
    child.stdin?.end(input ?? '');
  });
}

/** Linux keychain through libsecret's `secret-tool`. The token is passed on stdin, never as an argument. */
export class SecretToolStore implements TokenStore {
  readonly kind = 'keychain' as const;

  static async available(): Promise<boolean> {
    if (process.platform !== 'linux') {
      return false;
    }
    const result = await run('secret-tool', ['search', '--all', 'service', SERVICE]);
    return result.code === 0 || result.code === 1;
  }

  async get(profile: string): Promise<string | null> {
    const result = await run('secret-tool', ['lookup', 'service', SERVICE, 'profile', profile]);
    const token = result.stdout.trim();
    return result.code === 0 && token !== '' ? token : null;
  }

  async set(profile: string, url: string, token: string): Promise<void> {
    const result = await run(
      'secret-tool',
      ['store', `--label=Mopux CLI (${profile})`, 'service', SERVICE, 'profile', profile, 'url', url],
      token,
    );
    if (result.code !== 0) {
      throw new Error('Could not save the token in the system keychain.');
    }
  }

  async delete(profile: string): Promise<void> {
    await run('secret-tool', ['clear', 'service', SERVICE, 'profile', profile]);
  }
}

/** macOS Keychain through `security`. */
export class MacKeychainStore implements TokenStore {
  readonly kind = 'keychain' as const;

  static async available(): Promise<boolean> {
    if (process.platform !== 'darwin') {
      return false;
    }
    return (await run('security', ['help'])).code !== 127;
  }

  async get(profile: string): Promise<string | null> {
    const result = await run('security', ['find-generic-password', '-s', SERVICE, '-a', profile, '-w']);
    const token = result.stdout.trim();
    return result.code === 0 && token !== '' ? token : null;
  }

  async set(profile: string, _url: string, token: string): Promise<void> {
    // Interactive mode reads the command from stdin, so the token never appears in the process
    // list; -U updates an existing item.
    const quote = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`;
    const command = `add-generic-password -U -s ${SERVICE} -a ${quote(profile)} -w ${quote(token)}\n`;
    const result = await run('security', ['-i'], command);
    if (result.code !== 0) {
      throw new Error('Could not save the token in the macOS Keychain.');
    }
  }

  async delete(profile: string): Promise<void> {
    await run('security', ['delete-generic-password', '-s', SERVICE, '-a', profile]);
  }
}

/** The system keychain when there is one, otherwise the credentials file. */
export async function defaultTokenStore(dir: string, env: NodeJS.ProcessEnv): Promise<TokenStore> {
  if (env.MOPUX_TOKEN_STORAGE !== 'file') {
    if (await SecretToolStore.available()) {
      return new SecretToolStore();
    }
    if (await MacKeychainStore.available()) {
      return new MacKeychainStore();
    }
  }
  return new FileTokenStore(dir);
}
