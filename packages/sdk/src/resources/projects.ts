import { InvalidInputError } from '../errors.js';
import { Page } from '../page.js';
import type {
  ProjectActivity,
  ProjectBoard,
  ProjectDetail,
  ProjectMember,
  ProjectSummary,
  QueryParams,
  RequestBody,
  ResponseData,
  TaskPriority,
  TaskStatusRead,
} from '../types.js';
import * as v from '../validate.js';
import { Resource } from './resource.js';

export interface ProjectListOptions {
  search?: string;
  page?: number;
  perPage?: number;
}

export interface BoardOptions {
  search?: string;
  /** Include archived groups. The API includes them by default; the SDK does not. */
  includeArchived?: boolean;
  /** Only tasks assigned to these users. */
  users?: number[];
  statuses?: TaskStatusRead[];
  priorities?: TaskPriority[];
}

export interface ActivityOptions {
  filter?: QueryParams<'projectsActivity'>['filter'];
  /** Raw activity type, e.g. `update-task-status`. */
  type?: string;
  userId?: number;
  from?: string | Date;
  to?: string | Date;
  page?: number;
  perPage?: number;
}

export type ProjectStatistics = ResponseData<'projectsSummary'>;

export class Projects extends Resource {
  /** Projects visible to the user, ordered by title. */
  async list(options: ProjectListOptions = {}): Promise<Page<ProjectSummary>> {
    const page = v.page(options.page ?? 1);
    const perPage = v.perPage(options.perPage ?? 20);
    const response = await this.connector.get('projects', { q: options.search, page, per_page: perPage });
    return Page.from<ProjectSummary>(response.data, page, perPage);
  }

  /** Every project, page after page. */
  iterate(options: Omit<ProjectListOptions, 'page'> = {}): AsyncGenerator<ProjectSummary> {
    return Page.iterate((page) => this.list({ ...options, page, perPage: options.perPage ?? 100 }));
  }

  async create(project: RequestBody<'projectsCreate'>): Promise<ProjectDetail> {
    const response = await this.connector.post('projects', { ...project, title: v.title(project.title) });
    return response.data as ProjectDetail;
  }

  async show(projectId: number): Promise<ProjectDetail> {
    return (await this.connector.get(path(projectId))).data as ProjectDetail;
  }

  /** Only the given fields change; null clears description and dates. */
  async update(projectId: number, changes: RequestBody<'projectsUpdate'>): Promise<ProjectDetail> {
    if (Object.keys(changes).length === 0) {
      throw new InvalidInputError('changes', 'provide at least one field to update.');
    }
    return (await this.connector.patch(path(projectId), changes)).data as ProjectDetail;
  }

  /** Deletes the project. `confirmSlug` must be the project slug, as a safeguard. */
  async delete(projectId: number, confirmSlug: string): Promise<void> {
    await this.connector.delete(path(projectId), { json: { confirm: v.text(confirmSlug, 'confirmSlug') } });
  }

  /** The whole board in one request: groups in order with their open tasks, and the members. */
  async board(projectId: number, options: BoardOptions = {}): Promise<ProjectBoard> {
    const params = {
      ...(options.users?.length ? { users: v.ids(options.users, 'users') } : {}),
      ...(options.statuses?.length ? { status: options.statuses } : {}),
      ...(options.priorities?.length ? { priority: options.priorities } : {}),
    };
    const response = await this.connector.get(path(projectId, 'board'), {
      archived: options.includeArchived ?? false,
      search: options.search,
      params: Object.keys(params).length === 0 ? undefined : params,
    });
    return response.data as ProjectBoard;
  }

  /** Activity log, newest first. */
  async activity(projectId: number, options: ActivityOptions = {}): Promise<Page<ProjectActivity>> {
    const from = options.from === undefined ? undefined : v.date(options.from, 'from');
    const to = options.to === undefined ? undefined : v.date(options.to, 'to');
    if (from !== undefined && to !== undefined && to < from) {
      throw new InvalidInputError('to', 'cannot be before from.');
    }
    const page = v.page(options.page ?? 1);
    const perPage = v.perPage(options.perPage ?? 25);
    const response = await this.connector.get(path(projectId, 'activity'), {
      filter: options.filter,
      type: options.type,
      user_id: options.userId === undefined ? undefined : v.id(options.userId, 'userId'),
      from,
      to,
      page,
      per_page: perPage,
    });
    return Page.from<ProjectActivity>(response.data, page, perPage);
  }

  iterateActivity(projectId: number, options: Omit<ActivityOptions, 'page'> = {}): AsyncGenerator<ProjectActivity> {
    return Page.iterate((page) => this.activity(projectId, { ...options, page, perPage: options.perPage ?? 100 }));
  }

  /** Progress per group and workload per member. */
  async summary(projectId: number): Promise<ProjectStatistics> {
    return (await this.connector.get(path(projectId, 'summary'))).data as ProjectStatistics;
  }

  async members(projectId: number): Promise<ProjectMember[]> {
    return members((await this.connector.get(path(projectId, 'members'))).data);
  }

  /** Adds an installation user to the project and returns the members. */
  async addMember(projectId: number, userId: number): Promise<ProjectMember[]> {
    return members((await this.connector.post(path(projectId, 'members'), { user_id: v.id(userId, 'userId') })).data);
  }

  async removeMember(projectId: number, userId: number): Promise<ProjectMember[]> {
    return members((await this.connector.delete(path(projectId, `members/${v.id(userId, 'userId')}`))).data);
  }
}

function path(projectId: number, suffix = ''): string {
  return `projects/${v.id(projectId, 'projectId')}${suffix === '' ? '' : `/${suffix}`}`;
}

function members(data: unknown): ProjectMember[] {
  return ((data as { members?: ProjectMember[] } | null)?.members ?? []) as ProjectMember[];
}
