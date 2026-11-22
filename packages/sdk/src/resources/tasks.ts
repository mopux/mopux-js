import { InvalidInputError } from '../errors.js';
import { Page } from '../page.js';
import type {
  Attachment,
  FocusList,
  RequestBody,
  ResponseData,
  TaskBatchUpdateInput,
  TaskCreateInput,
  TaskDetail,
  TaskPriority,
  TaskStatus,
  TaskSummary,
  TaskUpdateInput,
  Touch,
} from '../types.js';
import type { Upload } from '../upload.js';
import * as v from '../validate.js';
import { Resource } from './resource.js';

export type MovedTask = ResponseData<'tasksMove'>;
export type MoveOptions = ResponseData<'tasksMoveOptions'>;
export type MarkdownHelp = ResponseData<'tasksMarkdownHelp'>;

/** Hours as `HH:MM` or minutes; null clears the value. */
export type HoursInput = string | number | null;

export interface MyTasksOptions {
  search?: string;
  projectIds?: number[];
}

export class Tasks extends Resource {
  /**
   * Creates a task. Rich fields are optional; `assignees` is the list of user ids. Unknown fields
   * are rejected by the API (422). A 5xx throws UncertainWriteError: check before creating again.
   */
  async create(task: TaskCreateInput): Promise<TaskDetail> {
    const body = { ...task, title: v.title(task.title) };
    for (const field of ['hours_expected', 'hours_inverted'] as const) {
      const value = body[field];
      if (typeof value === 'string') {
        body[field] = v.hours(value, field);
      }
    }
    return (await this.connector.post('tasks', body)).data as TaskDetail;
  }

  /**
   * Updates only the given fields, atomically. `assignees` is a mutation:
   * `{ operation: 'add' | 'remove' | 'replace', user_ids: [...] }`. null clears description,
   * dates and hours.
   */
  async update(taskId: number, changes: TaskUpdateInput): Promise<TaskDetail> {
    if (Object.keys(changes).length === 0) {
      throw new InvalidInputError('changes', 'provide at least one field to update.');
    }
    return (await this.connector.patch(path(taskId), changes)).data as TaskDetail;
  }

  /** Updates up to 4 tasks in one atomic operation. */
  async updateBatch(batch: TaskBatchUpdateInput['tasks']): Promise<TaskDetail[]> {
    if (batch.length === 0 || batch.length > 4) {
      throw new InvalidInputError('tasks', 'provide between 1 and 4 tasks.');
    }
    const response = await this.connector.patch('tasks/batch', { tasks: batch });
    return ((response.data as ResponseData<'tasksUpdateBatch'>)?.tasks ?? []) as TaskDetail[];
  }

  /** Tasks assigned to the user: open ones and those done in the last 15 days. Not paginated. */
  async my(options: MyTasksOptions = {}): Promise<TaskSummary[]> {
    const response = await this.connector.get('tasks/my', {
      search: options.search,
      params: options.projectIds?.length ? { projects: v.ids(options.projectIds, 'projectIds') } : undefined,
    });
    return (response.data ?? []) as TaskSummary[];
  }

  async show(taskId: number): Promise<TaskDetail> {
    return (await this.connector.get(path(taskId))).data as TaskDetail;
  }

  async delete(taskId: number): Promise<void> {
    await this.connector.delete(path(taskId));
  }

  async updateStatus(taskId: number, status: TaskStatus): Promise<TaskDetail> {
    if (![0, 1, 2, 3].includes(status)) {
      throw new InvalidInputError('status', 'must be 0, 1, 2 or 3 (delayed, -1, is read only).');
    }
    return this.patchTask(taskId, 'status', { status });
  }

  async updatePriority(taskId: number, priority: TaskPriority): Promise<TaskDetail> {
    return this.patchTask(taskId, 'priority', { priority });
  }

  /** Legacy single assignment (null unassigns everybody). Prefer update() with `assignees`. */
  async assign(taskId: number, userId: number | null): Promise<TaskDetail> {
    return this.patchTask(taskId, 'assign', { assignee_id: userId === null ? null : v.id(userId, 'userId') });
  }

  /** Moves the task to a group of the same or another project. */
  async move(taskId: number, projectId: number, groupId: number): Promise<MovedTask> {
    const response = await this.connector.patch(path(taskId, 'move'), {
      project_id: v.id(projectId, 'projectId'),
      group_id: v.id(groupId, 'groupId'),
    });
    return response.data as MovedTask;
  }

  async updateTitle(taskId: number, title: string): Promise<TaskDetail> {
    return this.patchTask(taskId, 'title', { title: v.title(title) });
  }

  async updateDescription(taskId: number, description: string | null): Promise<TaskDetail> {
    return this.patchTask(taskId, 'description', { description });
  }

  async updateStart(taskId: number, date: string | Date | null): Promise<TaskDetail> {
    return this.patchTask(taskId, 'start', { date_start: date === null ? null : v.date(date, 'date_start') });
  }

  async updateEnd(taskId: number, date: string | Date | null): Promise<TaskDetail> {
    return this.patchTask(taskId, 'end', { date_end: date === null ? null : v.date(date, 'date_end') });
  }

  /** Expected and/or worked hours. An omitted value is kept; null clears it. */
  async updateHours(taskId: number, hours: { expected?: HoursInput; inverted?: HoursInput }): Promise<TaskDetail> {
    const body: RequestBody<'tasksUpdateHours'> = {};
    if (hours.expected !== undefined) {
      body.hours_expected = hours.expected === null ? null : v.hours(hours.expected, 'hours_expected');
    }
    if (hours.inverted !== undefined) {
      body.hours_inverted = hours.inverted === null ? null : v.hours(hours.inverted, 'hours_inverted');
    }
    if (Object.keys(body).length === 0) {
      throw new InvalidInputError('hours', 'provide expected or inverted hours.');
    }
    return this.patchTask(taskId, 'hours', body);
  }

  /** Sends a touch (a nudge about this task) to a project member. */
  async sendTouch(taskId: number, recipientId: number, message?: string | null): Promise<Touch> {
    const response = await this.connector.post(path(taskId, 'touches'), {
      recipient_id: v.id(recipientId, 'recipientId'),
      ...(message === undefined ? {} : { message }),
    });
    return response.data as Touch;
  }

  /** The user's personal focus list. */
  async focus(): Promise<FocusList> {
    return (await this.connector.get('tasks/focus')).data as FocusList;
  }

  async pinFocus(taskId: number): Promise<FocusList> {
    return (await this.connector.post(path(taskId, 'focus'))).data as FocusList;
  }

  async unpinFocus(taskId: number): Promise<FocusList> {
    return (await this.connector.delete(path(taskId, 'focus'))).data as FocusList;
  }

  /** Projects and groups the task can be moved to. */
  async moveOptions(taskId: number): Promise<MoveOptions> {
    return (await this.connector.get(path(taskId, 'move-options'))).data as MoveOptions;
  }

  /** Documents of the task and its comments. Download URLs expire after 15 minutes. */
  async attachments(taskId: number, options: { page?: number; perPage?: number } = {}): Promise<Page<Attachment>> {
    const page = v.page(options.page ?? 1);
    const perPage = v.perPage(options.perPage ?? 20);
    const response = await this.connector.get(path(taskId, 'attachments'), { page, per_page: perPage });
    return Page.fromPageFields<Attachment>(response.data, 'attachments', perPage);
  }

  iterateAttachments(taskId: number, options: { perPage?: number } = {}): AsyncGenerator<Attachment> {
    return Page.iterate((page) => this.attachments(taskId, { page, perPage: options.perPage ?? 100 }));
  }

  /** Uploads a document to the task (multipart). */
  async uploadFile(taskId: number, file: Upload): Promise<Attachment> {
    const form = new FormData();
    form.append('file', file.blob, file.filename);
    return (await this.connector.request('POST', path(taskId, 'files'), { form })).data as Attachment;
  }

  /** Deletes a document the user uploaded to the task. */
  async deleteFile(taskId: number, mediaId: number): Promise<void> {
    await this.connector.delete(path(taskId, `files/${v.id(mediaId, 'mediaId')}`));
  }

  /** Markdown supported in descriptions and comments. */
  async markdownHelp(): Promise<MarkdownHelp> {
    return (await this.connector.get('tasks/markdown-help')).data as MarkdownHelp;
  }

  private async patchTask(taskId: number, action: string, body: object): Promise<TaskDetail> {
    return (await this.connector.patch(path(taskId, action), body)).data as TaskDetail;
  }
}

function path(taskId: number, suffix = ''): string {
  return `tasks/${v.id(taskId, 'taskId')}${suffix === '' ? '' : `/${suffix}`}`;
}
