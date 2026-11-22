import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CliError } from './errors.js';

export interface Profile {
  url: string;
  /** Where the token is kept: the system keychain or the credentials file. */
  storage: 'keychain' | 'file';
  /** Email of the user who logged in, for `profiles list`. */
  email?: string;
}

export interface Config {
  defaultProfile: string | null;
  profiles: Record<string, Profile>;
}

export function configDir(env: NodeJS.ProcessEnv): string {
  if (env.MOPUX_CONFIG_DIR) {
    return env.MOPUX_CONFIG_DIR;
  }
  const base =
    env.XDG_CONFIG_HOME || (env.APPDATA && process.platform === 'win32' ? env.APPDATA : join(homedir(), '.config'));
  return join(base, 'mopux');
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new CliError(`${path} is not valid JSON. Fix or delete it.`);
  }
}

/** Writes atomically with permissions 600 (the directory gets 700). */
export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export class ConfigStore {
  constructor(private readonly dir: string) {}

  get path(): string {
    return join(this.dir, 'config.json');
  }

  async load(): Promise<Config> {
    const config = await readJson<Partial<Config>>(this.path, {});
    return { defaultProfile: config.defaultProfile ?? null, profiles: config.profiles ?? {} };
  }

  async save(config: Config): Promise<void> {
    await writePrivateJson(this.path, config);
  }
}
