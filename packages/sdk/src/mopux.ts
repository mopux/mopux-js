import { Connector, type MopuxOptions, type TokenSource } from './http/connector.js';
import { Auth } from './resources/auth.js';
import { Comments } from './resources/comments.js';
import { Notifications } from './resources/notifications.js';
import { Projects } from './resources/projects.js';
import { TaskGroups } from './resources/task-groups.js';
import { Tasks } from './resources/tasks.js';
import { Team, TeamInvitations } from './resources/team.js';
import { Touches } from './resources/touches.js';

/**
 * Client of one Mopux installation.
 *
 * ```ts
 * const mopux = new Mopux({ baseUrl: 'https://acme.mopux.com', token: process.env.MOPUX_TOKEN });
 * const tasks = await mopux.tasks.my();
 * ```
 */
export class Mopux {
  readonly auth: Auth;
  readonly projects: Projects;
  readonly taskGroups: TaskGroups;
  readonly tasks: Tasks;
  readonly comments: Comments;
  readonly notifications: Notifications;
  readonly touches: Touches;
  readonly team: Team;
  readonly teamInvitations: TeamInvitations;
  readonly connector: Connector;

  constructor(options: MopuxOptions | Connector) {
    this.connector = options instanceof Connector ? options : new Connector(options);
    this.auth = new Auth(this.connector);
    this.projects = new Projects(this.connector);
    this.taskGroups = new TaskGroups(this.connector);
    this.tasks = new Tasks(this.connector);
    this.comments = new Comments(this.connector);
    this.notifications = new Notifications(this.connector);
    this.touches = new Touches(this.connector);
    this.team = new Team(this.connector);
    this.teamInvitations = new TeamInvitations(this.connector);
  }

  /**
   * Logs in with email and password and returns a client that uses the new token.
   * Store `mopux.token` to reuse it instead of logging in on every run.
   */
  static async login(
    options: Omit<MopuxOptions, 'token'> & { email: string; password: string; tokenName?: string },
  ): Promise<Mopux & { token: string }> {
    const { email, password, tokenName, ...rest } = options;
    const anonymous = new Mopux(rest);
    const result = await anonymous.auth.login(email, password, tokenName);
    const token = result.token ?? '';
    return Object.assign(anonymous.withToken(token), { token });
  }

  /** A new client for the same installation with another token. */
  withToken(token: TokenSource): Mopux {
    return new Mopux(this.connector.withToken(token));
  }
}
