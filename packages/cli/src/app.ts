import { parseArgs } from 'node:util';
import { type Command, type Options, type Values } from './commands/command.js';
import { login, logout, profiles, whoami } from './commands/session.js';
import {
  board,
  notifications,
  projectsList,
  taskComment,
  taskCreate,
  taskShow,
  taskStatus,
  tasksMy,
} from './commands/work.js';
import { Context, type Dependencies } from './context.js';
import { describeError, ExitCode, UsageError } from './errors.js';
import { CLI_VERSION } from './version.js';

export const commands: Command[] = [
  login,
  logout,
  whoami,
  profiles,
  projectsList,
  board,
  tasksMy,
  taskShow,
  taskCreate,
  taskStatus,
  taskComment,
  notifications,
];

const GLOBAL_OPTIONS: Options = {
  json: { type: 'boolean' },
  profile: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

function help(): string {
  const width = Math.max(...commands.map((command) => command.path.join(' ').length));
  return [
    `mopux ${CLI_VERSION}: command line client for the Mopux API`,
    '',
    'Usage: mopux <command> [options]',
    '',
    'Commands:',
    ...commands.map((command) => `  ${command.path.join(' ').padEnd(width)}  ${command.summary}`),
    '',
    'Global options:',
    '  --json            Print the API data as JSON (for scripts)',
    '  --profile <name>  Use this profile instead of the default one',
    '  -h, --help        Help of a command: mopux <command> --help',
    '  -v, --version     Show the version',
    '',
    'Environment: MOPUX_URL and MOPUX_TOKEN (CI, no profile needed), MOPUX_PROFILE, MOPUX_CONFIG_DIR,',
    'MOPUX_TOKEN_STORAGE=file (do not use the system keychain).',
  ].join('\n');
}

function commandHelp(command: Command): string {
  return [`${command.summary}.`, '', `Usage: ${command.usage}`].join('\n');
}

function find(words: string[]): Command | undefined {
  return (
    commands.find(
      (command) => command.path.length === 2 && command.path[0] === words[0] && command.path[1] === words[1],
    ) ?? commands.find((command) => command.path.length === 1 && command.path[0] === words[0])
  );
}

/** Runs the CLI and returns the exit code. Never throws. */
export async function run(argv: string[], deps: Dependencies): Promise<number> {
  const io = deps.io;
  try {
    const loose = parseArgs({ args: argv, options: GLOBAL_OPTIONS, strict: false, allowPositionals: true });
    if (loose.values.version === true) {
      io.stdout(`${CLI_VERSION}\n`);
      return ExitCode.Ok;
    }
    const words = loose.positionals;
    const command = words.length === 0 ? undefined : find(words);
    if (command === undefined) {
      if (words.length === 0 || words[0] === 'help') {
        const target = words[0] === 'help' ? find(words.slice(1)) : undefined;
        io.stdout(`${target ? commandHelp(target) : help()}\n`);
        return ExitCode.Ok;
      }
      const group = commands.filter((candidate) => candidate.path[0] === words[0]);
      throw new UsageError(
        group.length > 0
          ? `Unknown "${words.join(' ')}". Available: ${group.map((candidate) => candidate.path.join(' ')).join(', ')}.`
          : `Unknown command "${words[0]}".`,
      );
    }
    if (loose.values.help === true) {
      io.stdout(`${commandHelp(command)}\n`);
      return ExitCode.Ok;
    }

    let parsed: { values: Values; positionals: string[] };
    try {
      parsed = parseArgs({
        args: argv,
        options: { ...GLOBAL_OPTIONS, ...(command.options ?? {}) },
        strict: true,
        allowPositionals: true,
      }) as { values: Values; positionals: string[] };
    } catch (error) {
      throw new UsageError(`${error instanceof Error ? error.message : String(error)}\nUsage: ${command.usage}`);
    }
    const args = parsed.positionals.slice(command.path.length);
    const profile = typeof parsed.values.profile === 'string' ? parsed.values.profile : undefined;
    const context = new Context(deps, parsed.values.json === true, profile);
    await command.run(context, parsed.values, args);
    return ExitCode.Ok;
  } catch (error) {
    const { message, exitCode } = describeError(error);
    io.stderr(`Error: ${message}\n`);
    return exitCode;
  }
}
