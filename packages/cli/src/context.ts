import { Mopux } from '@mopux/sdk';
import { type Config, ConfigStore, configDir, type Profile } from './config.js';
import { defaultTokenStore, FileTokenStore, type TokenStore } from './credentials.js';
import { CliError, ExitCode } from './errors.js';
import { CLI_VERSION } from './version.js';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  /** Whole standard input (for `--with-token`). */
  readStdin(): Promise<string>;
  /** Asks a question; `hidden` does not echo what is typed. */
  prompt(question: string, options?: { hidden?: boolean }): Promise<string>;
  readonly interactive: boolean;
}

export interface Dependencies {
  io: Io;
  env: NodeJS.ProcessEnv;
  /** Overrides the token store (tests). */
  tokenStore?: TokenStore;
  /** Overrides fetch (tests). */
  fetch?: typeof fetch;
}

export interface ResolvedTarget {
  profileName: string | null;
  url: string;
  token: string;
}

export class Context {
  readonly configStore: ConfigStore;
  readonly dir: string;
  private keychain: TokenStore | null = null;

  constructor(
    readonly deps: Dependencies,
    readonly json: boolean,
    readonly profileFlag: string | undefined,
  ) {
    this.dir = configDir(deps.env);
    this.configStore = new ConfigStore(this.dir);
  }

  get io(): Io {
    return this.deps.io;
  }

  print(text: string): void {
    this.io.stdout(text.endsWith('\n') ? text : `${text}\n`);
  }

  printJson(value: unknown): void {
    this.print(JSON.stringify(value, null, 2));
  }

  /** The store for new logins: the keychain when available, otherwise the file. */
  async preferredStore(): Promise<TokenStore> {
    if (this.deps.tokenStore) {
      return this.deps.tokenStore;
    }
    this.keychain ??= await defaultTokenStore(this.dir, this.deps.env);
    return this.keychain;
  }

  async storeFor(profile: Profile): Promise<TokenStore> {
    if (this.deps.tokenStore) {
      return this.deps.tokenStore;
    }
    if (profile.storage === 'file') {
      return new FileTokenStore(this.dir);
    }
    const store = await this.preferredStore();
    if (store.kind !== 'keychain') {
      throw new CliError(
        'This profile keeps its token in the system keychain, which is not available here. Run "mopux login" again.',
        ExitCode.Auth,
      );
    }
    return store;
  }

  /** Name of the profile to use: --profile, MOPUX_PROFILE or the default one. */
  profileName(config: Config): string | null {
    return this.profileFlag ?? this.deps.env.MOPUX_PROFILE ?? config.defaultProfile;
  }

  /** URL and token: MOPUX_URL + MOPUX_TOKEN win over the profiles (CI). */
  async target(): Promise<ResolvedTarget> {
    const { MOPUX_URL: url, MOPUX_TOKEN: token } = this.deps.env;
    if (url && token && this.profileFlag === undefined) {
      return { profileName: null, url, token };
    }
    const config = await this.configStore.load();
    const name = this.profileName(config);
    if (name === null) {
      throw new CliError('You are not logged in. Run "mopux login <url>" first.', ExitCode.Auth);
    }
    const profile = config.profiles[name];
    if (profile === undefined) {
      throw new CliError(`Profile "${name}" does not exist. Run "mopux profiles list".`, ExitCode.Usage);
    }
    const stored = await (await this.storeFor(profile)).get(name, profile.url);
    if (stored === null) {
      throw new CliError(`Profile "${name}" has no saved session. Run "mopux login --profile ${name}".`, ExitCode.Auth);
    }
    return { profileName: name, url: profile.url, token: stored };
  }

  client(url: string, token: string | null): Mopux {
    return new Mopux({
      baseUrl: url,
      token,
      userAgent: `mopux-cli/${CLI_VERSION}`,
      ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
      ...(this.deps.fetch ? { retry: { sleep: async () => {} } } : {}),
    });
  }

  async authenticatedClient(): Promise<Mopux> {
    const target = await this.target();
    return this.client(target.url, target.token);
  }
}
