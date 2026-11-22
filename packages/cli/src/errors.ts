import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  ConnectionError,
  InvalidInputError,
  MopuxError,
  NotFoundError,
  RateLimitError,
  UncertainWriteError,
  ValidationError,
} from '@mopux/sdk';

export const ExitCode = { Ok: 0, Error: 1, Usage: 2, Auth: 3, Forbidden: 4 } as const;

/** Wrong command, missing argument or invalid option. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** A failure explained to the user, with its exit code. */
export class CliError extends Error {
  override name = 'CliError';

  constructor(
    message: string,
    readonly exitCode: number = ExitCode.Error,
  ) {
    super(message);
  }
}

/** A message for humans and the exit code of any error thrown by a command. */
export function describeError(error: unknown): { message: string; exitCode: number } {
  if (error instanceof UsageError) {
    return { message: `${error.message}\nRun "mopux --help" to see the commands.`, exitCode: ExitCode.Usage };
  }
  if (error instanceof CliError) {
    return { message: error.message, exitCode: error.exitCode };
  }
  if (error instanceof InvalidInputError) {
    return { message: error.message, exitCode: ExitCode.Usage };
  }
  if (error instanceof AuthenticationError) {
    return {
      message: 'Your session is not valid (expired, revoked or wrong token). Run "mopux login" again.',
      exitCode: ExitCode.Auth,
    };
  }
  if (error instanceof AuthorizationError) {
    if (error.isPlanRestriction()) {
      return {
        message: `The plan of this installation does not include ${error.planFeature === 'api' ? 'the API' : `"${error.planFeature ?? 'this feature'}"`}. Ask an administrator to change the plan.`,
        exitCode: ExitCode.Forbidden,
      };
    }
    if (error.isBillingBlocked()) {
      return {
        message: 'This installation is blocked by billing. An administrator must review the subscription.',
        exitCode: ExitCode.Forbidden,
      };
    }
    return { message: `Not allowed: ${error.apiMessage ?? error.message}`, exitCode: ExitCode.Forbidden };
  }
  if (error instanceof ValidationError) {
    const lines = Object.entries(error.errors).map(([field, messages]) => `  ${field}: ${messages.join(' ')}`);
    return {
      message: lines.length > 0 ? `The API rejected the data:\n${lines.join('\n')}` : error.message,
      exitCode: ExitCode.Error,
    };
  }
  if (error instanceof NotFoundError) {
    return { message: `Not found: ${error.path}`, exitCode: ExitCode.Error };
  }
  if (error instanceof RateLimitError) {
    const wait = error.retryAfter === null ? '' : ` Try again in ${error.retryAfter} s.`;
    return { message: `Too many requests.${wait}`, exitCode: ExitCode.Error };
  }
  if (error instanceof UncertainWriteError) {
    return {
      message:
        'The server failed while saving. The change may have been applied: check before running the command again.',
      exitCode: ExitCode.Error,
    };
  }
  if (error instanceof ConnectionError) {
    const uncertain = error.isWriteOutcomeUncertain ? ' The change may have been applied: check before retrying.' : '';
    return { message: `${error.message}${uncertain}`, exitCode: ExitCode.Error };
  }
  if (error instanceof ApiError || error instanceof MopuxError) {
    return { message: error.message, exitCode: ExitCode.Error };
  }
  return { message: error instanceof Error ? error.message : String(error), exitCode: ExitCode.Error };
}
