import { InvalidInputError } from '../errors.js';
import type { ProjectDetail, ResponseData, TaskBoard, TaskDetail, TaskGroup, TaskGroupCompoundTask } from '../types.js';
import * as v from '../validate.js';
import { Resource } from './resource.js';

export type TaskGroupWithTasks = TaskGroup & { tasks: TaskDetail[] };
export type GroupStatusSummary = ResponseData<'taskGroupsStatusSummary'>;
export type GroupPositions = NonNullable<ResponseData<'taskGroupsReorder'>['task_groups']>;
export type TaskPositions = NonNullable<ResponseData<'taskGroupsReorderTasks'>['tasks']>;

export class TaskGroups extends Resource {
  /**
   * Creates a group, optionally with up to 4 tasks in the same atomic operation (nothing is
   * created if any task fails). The result includes the created tasks (empty without tasks).
   */
  async create(projectId: number, title: string, tasks: TaskGroupCompoundTask[] = []): Promise<TaskGroupWithTasks> {
    if (tasks.length > 4) {
      throw new InvalidInputError('tasks', 'at most 4 tasks can be created with a group.');
    }
    const response = await this.connector.post(path(projectId), {
      title: v.title(title),
      ...(tasks.length === 0 ? {} : { tasks: tasks.map((task) => ({ ...task, title: v.title(task.title) })) }),
    });
    const data = response.data as ResponseData<'taskGroupsCreate'>;
    if (data !== undefined && 'group' in data) {
      return { ...data.group, tasks: data.tasks };
    }
    return { ...(data as TaskGroup), tasks: [] };
  }

  /** Sets the order of the project's groups: the first id goes first. */
  async reorder(projectId: number, groupIds: number[]): Promise<GroupPositions> {
    const response = await this.connector.patch(path(projectId, 'reorder'), { groups: order(groupIds, 'groupIds') });
    return ((response.data as ResponseData<'taskGroupsReorder'>)?.task_groups ?? []) as GroupPositions;
  }

  /** Sets the manual order of the tasks of a group: the first id goes first. */
  async reorderTasks(projectId: number, groupId: number, taskIds: number[]): Promise<TaskPositions> {
    const response = await this.connector.patch(path(projectId, `${v.id(groupId, 'groupId')}/tasks/reorder`), {
      tasks: order(taskIds, 'taskIds'),
    });
    return ((response.data as ResponseData<'taskGroupsReorderTasks'>)?.tasks ?? []) as TaskPositions;
  }

  async rename(projectId: number, groupId: number, title: string): Promise<TaskGroup> {
    return this.patchGroup(projectId, groupId, 'title', { title: v.title(title) });
  }

  async archive(projectId: number, groupId: number): Promise<TaskGroup> {
    return this.patchGroup(projectId, groupId, 'archive');
  }

  async unarchive(projectId: number, groupId: number): Promise<TaskGroup> {
    return this.patchGroup(projectId, groupId, 'unarchive');
  }

  /** Moves the group, with its tasks, to another project. */
  async move(projectId: number, groupId: number, toProjectId: number): Promise<TaskGroup> {
    return this.patchGroup(projectId, groupId, 'move', { project_id: v.id(toProjectId, 'toProjectId') });
  }

  /** Copies the group, with its tasks, to a project (the same or another). */
  async copy(projectId: number, groupId: number, toProjectId: number, title: string): Promise<TaskGroup> {
    return this.patchGroup(projectId, groupId, 'copy', {
      project_id: v.id(toProjectId, 'toProjectId'),
      title: v.title(title),
    });
  }

  /** Creates a new project from the group and its tasks. */
  async createProject(
    projectId: number,
    groupId: number,
    title: string,
    description?: string | null,
  ): Promise<ProjectDetail> {
    const response = await this.connector.post(path(projectId, `${v.id(groupId, 'groupId')}/create-project`), {
      title: v.title(title),
      ...(description === undefined ? {} : { description }),
    });
    return response.data as ProjectDetail;
  }

  async delete(projectId: number, groupId: number): Promise<void> {
    await this.connector.delete(path(projectId, String(v.id(groupId, 'groupId'))));
  }

  /** The group with its tasks ordered by status. */
  async focus(projectId: number, groupId: number, search?: string): Promise<TaskGroup & { tasks: TaskBoard[] }> {
    const response = await this.connector.get(path(projectId, `${v.id(groupId, 'groupId')}/focus`), { search });
    const data = response.data as ResponseData<'taskGroupsFocus'>;
    return { ...(data?.group as TaskGroup), tasks: data?.tasks ?? [] };
  }

  /** Number of tasks per status, including delayed ones. */
  async statusSummary(projectId: number, groupId: number): Promise<GroupStatusSummary> {
    return (await this.connector.get(path(projectId, `${v.id(groupId, 'groupId')}/status-summary`)))
      .data as GroupStatusSummary;
  }

  private async patchGroup(projectId: number, groupId: number, action: string, body?: object): Promise<TaskGroup> {
    const response = await this.connector.patch(path(projectId, `${v.id(groupId, 'groupId')}/${action}`), body);
    return response.data as TaskGroup;
  }
}

function path(projectId: number, suffix = ''): string {
  return `projects/${v.id(projectId, 'projectId')}/task-groups${suffix === '' ? '' : `/${suffix}`}`;
}

function order(ids: number[], field: string): { value: number; order: number }[] {
  if (ids.length === 0) {
    throw new InvalidInputError(field, 'provide at least one id.');
  }
  if (new Set(ids).size !== ids.length) {
    throw new InvalidInputError(field, 'contains duplicates.');
  }
  return v.ids(ids, field).map((value, index) => ({ value, order: index + 1 }));
}
