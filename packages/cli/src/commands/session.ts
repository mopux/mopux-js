import { hostname } from 'node:os';
import { AuthenticationError } from '@mopux/sdk';
import type { Profile } from '../config.js';
import type { Context } from '../context.js';
import { CliError, UsageError } from '../errors.js';
import { details, table } from '../output.js';
import { type Command, flag, str } from './command.js';

function normalizeUrl(input: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UsageError(`"${input}" is not a valid URL.`);
  }
  return url.origin;
}

function defaultProfileName(url: string): string {
  const label = new URL(url).hostname.split('.')[0] ?? '';
  return /^[a-z0-9][a-z0-9-]*$/i.test(label) ? label.toLowerCase() : 'default';
}

export const login: Command = {
  path: ['login'],
  summary: 'Log in to an installation and save the session in a profile',
  usage: 'mopux login [url] [--email <email>] [--profile <name>] [--token-name <name>] [--with-token] [--default]',
  options: {
    url: { type: 'string' },
    email: { type: 'string' },
    'token-name': { type: 'string' },
    'with-token': { type: 'boolean' },
    default: { type: 'boolean' },
  },
  async run(context, values, args) {
    const config = await context.configStore.load();
    const existing = context.profileFlag ? config.profiles[context.profileFlag] : undefined;
    let rawUrl = args[0] ?? str(values, 'url') ?? existing?.url;
    if (rawUrl === undefined) {
      if (!context.io.interactive) {
        throw new UsageError('Missing the installation URL, e.g. "mopux login https://acme.mopux.com".');
      }
      rawUrl = await context.io.prompt('Installation URL (e.g. https://acme.mopux.com): ');
    }
    const url = normalizeUrl(rawUrl.trim());
    const profileName = context.profileFlag ?? defaultProfileName(url);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(profileName)) {
      throw new UsageError('Profile names may only contain letters, digits, "-" and "_".');
    }

    let token: string;
    let email: string | undefined;
    if (flag(values, 'with-token')) {
      token = (await context.io.readStdin()).trim();
      if (token === '') {
        throw new UsageError('--with-token reads the token from standard input, and it was empty.');
      }
      const user = await context.client(url, token).auth.user();
      email = user.email;
    } else {
      email = str(values, 'email') ?? existing?.email;
      if (email === undefined) {
        if (!context.io.interactive) {
          throw new UsageError('Missing --email (or use --with-token in scripts).');
        }
        email = (await context.io.prompt('Email: ')).trim();
      }
      if (!context.io.interactive) {
        throw new UsageError('The password is asked interactively. In scripts, use --with-token.');
      }
      const password = await context.io.prompt('Password: ', { hidden: true });
      const result = await context
        .client(url, null)
        .auth.login(email, password, str(values, 'token-name') ?? `mopux-cli@${hostname()}`);
      if (!result.token) {
        throw new CliError('The API did not return a token.');
      }
      token = result.token;
    }

    const store = await context.preferredStore();
    const previous = config.profiles[profileName];
    if (previous && previous.storage !== store.kind) {
      await (await context.storeFor(previous)).delete(profileName, previous.url);
    }
    await store.set(profileName, url, token);
    const profile: Profile = { url, storage: store.kind, ...(email ? { email } : {}) };
    config.profiles[profileName] = profile;
    if (config.defaultProfile === null || flag(values, 'default') || !(config.defaultProfile in config.profiles)) {
      config.defaultProfile = profileName;
    }
    await context.configStore.save(config);

    if (context.json) {
      context.printJson({ profile: profileName, url, email: email ?? null, storage: store.kind });
      return;
    }
    const where =
      store.kind === 'keychain' ? 'the system keychain' : `${context.dir}/credentials.json (permissions 600)`;
    context.print(
      `Logged in to ${url} as ${email ?? 'the token user'}. Profile "${profileName}", token saved in ${where}.`,
    );
    if (config.defaultProfile === profileName) {
      context.print(`"${profileName}" is the default profile.`);
    }
  },
};

export const logout: Command = {
  path: ['logout'],
  summary: 'Revoke the token of a profile and forget it',
  usage: 'mopux logout [--profile <name>]',
  async run(context) {
    const config = await context.configStore.load();
    const name = context.profileName(config);
    const profile = name === null ? undefined : config.profiles[name];
    if (name === null || profile === undefined) {
      throw new UsageError('No profile to log out from.');
    }
    const store = await context.storeFor(profile);
    const token = await store.get(name, profile.url);
    if (token !== null) {
      try {
        await context.client(profile.url, token).auth.logout();
      } catch (error) {
        if (!(error instanceof AuthenticationError)) {
          throw error;
        }
      }
      await store.delete(name, profile.url);
    }
    context.json
      ? context.printJson({ profile: name, loggedOut: true })
      : context.print(`Logged out of profile "${name}".`);
  },
};

export const whoami: Command = {
  path: ['whoami'],
  summary: 'Show the user and installation in use',
  usage: 'mopux whoami [--profile <name>]',
  async run(context) {
    const target = await context.target();
    const user = await context.client(target.url, target.token).auth.user();
    if (context.json) {
      context.printJson({ profile: target.profileName, url: target.url, user });
      return;
    }
    context.print(
      details([
        ['User', `${user.name ?? ''} <${user.email ?? ''}>`],
        ['Installation', target.url],
        ['Profile', target.profileName ?? '(MOPUX_URL / MOPUX_TOKEN)'],
      ]),
    );
  },
};

export const profiles: Command = {
  path: ['profiles'],
  summary: 'List profiles, choose the default one or remove one',
  usage: 'mopux profiles [list | use <name> | remove <name>]',
  async run(context, _values, args) {
    const config = await context.configStore.load();
    const action = args[0] ?? 'list';
    if (action === 'list') {
      if (context.json) {
        context.printJson(config);
        return;
      }
      const names = Object.keys(config.profiles).sort();
      if (names.length === 0) {
        context.print('No profiles yet. Run "mopux login <url>".');
        return;
      }
      context.print(
        table(
          ['', 'Profile', 'URL', 'Email', 'Token in'],
          names.map((name) => {
            const profile = config.profiles[name] as Profile;
            return [name === config.defaultProfile ? '*' : '', name, profile.url, profile.email, profile.storage];
          }),
        ),
      );
      return;
    }
    const name = args[1];
    if ((action !== 'use' && action !== 'remove') || name === undefined) {
      throw new UsageError(`Usage: ${this.usage}`);
    }
    const profile = config.profiles[name];
    if (profile === undefined) {
      throw new UsageError(`Profile "${name}" does not exist.`);
    }
    if (action === 'use') {
      config.defaultProfile = name;
      await context.configStore.save(config);
      context.print(`"${name}" is now the default profile.`);
      return;
    }
    await (await context.storeFor(profile)).delete(name, profile.url);
    delete config.profiles[name];
    if (config.defaultProfile === name) {
      config.defaultProfile = Object.keys(config.profiles).sort()[0] ?? null;
    }
    await context.configStore.save(config);
    context.print(`Profile "${name}" removed (the token was not revoked; use "mopux logout" for that).`);
  },
};

export type { Context };
