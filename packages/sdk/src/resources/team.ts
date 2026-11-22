import { Page } from '../page.js';
import type { QueryParams, ResponseData, TeamInvitation } from '../types.js';
import * as v from '../validate.js';
import { Resource } from './resource.js';

export type TeamMember = NonNullable<ResponseData<'teamList'>['members']>[number];

export interface TeamListOptions {
  search?: string;
  role?: string;
  page?: number;
  perPage?: number;
}

export class Team extends Resource {
  /** Users of the installation. Requires permission to manage the team. */
  async list(options: TeamListOptions = {}): Promise<Page<TeamMember>> {
    const page = v.page(options.page ?? 1);
    const perPage = v.perPage(options.perPage ?? 25);
    const response = await this.connector.get('team', {
      search: options.search,
      role: options.role,
      page,
      per_page: perPage,
    });
    return Page.fromPageFields<TeamMember>(response.data, 'members', perPage);
  }

  iterate(options: Omit<TeamListOptions, 'page'> = {}): AsyncGenerator<TeamMember> {
    return Page.iterate((page) => this.list({ ...options, page, perPage: options.perPage ?? 100 }));
  }
}

export interface InvitationListOptions {
  search?: string;
  status?: QueryParams<'teamInvitationsList'>['status'];
  page?: number;
  perPage?: number;
}

export class TeamInvitations extends Resource {
  async list(options: InvitationListOptions = {}): Promise<Page<TeamInvitation>> {
    const page = v.page(options.page ?? 1);
    const perPage = v.perPage(options.perPage ?? 20);
    const response = await this.connector.get('team/invitations', {
      q: options.search,
      status: options.status ?? 'all',
      page,
      per_page: perPage,
    });
    return Page.from<TeamInvitation>(response.data, page, perPage);
  }

  iterate(options: Omit<InvitationListOptions, 'page'> = {}): AsyncGenerator<TeamInvitation> {
    return Page.iterate((page) => this.list({ ...options, page, perPage: options.perPage ?? 100 }));
  }

  /**
   * Invites a user with a role (id of a web role; not the administrator role). The user type
   * follows the role; `userType`, if given, must match it.
   */
  async create(email: string, roleId: number, userType?: 'internal' | 'external'): Promise<TeamInvitation> {
    const response = await this.connector.post('team/invitations', {
      email: v.text(email, 'email'),
      rol: v.id(roleId, 'roleId'),
      ...(userType === undefined ? {} : { user_type: userType }),
    });
    return response.data as TeamInvitation;
  }

  async resend(invitationId: number): Promise<TeamInvitation> {
    return (await this.connector.post(`team/invitations/${v.id(invitationId, 'invitationId')}/resend`))
      .data as TeamInvitation;
  }

  async delete(invitationId: number): Promise<void> {
    await this.connector.delete(`team/invitations/${v.id(invitationId, 'invitationId')}`);
  }
}
