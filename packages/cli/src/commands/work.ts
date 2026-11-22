import { type ProjectSummary, type TaskDetail, type TaskPriority, type TaskStatus, Upload } from '@mopux/sdk';
import { UsageError } from '../errors.js';
import { details, priorityName, projectStatusName, statusName, table, truncate } from '../output.js';
import { arg, type Command, flag, positiveInt, str, strings } from './command.js';

const STATUS_WORDS: Record<string, TaskStatus> = {
  pending: 0,
  todo: 0,
  doing: 1,
  'in-progress': 1,
  progress: 1,
  review: 2,
  done: 3,
};
const PRIORITY_WORDS: Record<string, TaskPriority> = { low: 0, normal: 1, high: 2, max: 9, maximum: 9 };

function parseStatus(value: string): TaskStatus {
  const status =
    STATUS_WORDS[value.toLowerCase()] ??
    (['0', '1', '2', '3'].includes(value) ? (Number(value) as TaskStatus) : undefined);
  if (status === undefined) {
    throw new UsageError(`Unknown status "${value}". Use pending, doing, review or done.`);
  }
  return status;
}

function parsePriority(value: string): TaskPriority {
  const priority =
    PRIORITY_WORDS[value.toLowerCase()] ??
    (['0', '1', '2', '9'].includes(value) ? (Number(value) as TaskPriority) : undefined);
  if (priority === undefined) {
    throw new UsageError(`Unknown priority "${value}". Use low, normal, high or max.`);
  }
  return priority;
}

function taskDetails(task: TaskDetail): string {
  return details([
    ['Task', `#${task.id} ${task.title ?? ''}`],
    ['Project', task.project ? `${task.project.title} (#${task.project.id})` : undefined],
    ['Group', task.group ? `${task.group.title} (#${task.group.id})` : undefined],
    ['Status', statusName(task.status)],
    ['Priority', priorityName(task.priority)],
    ['Start', task.date_start],
    ['End', task.date_end],
    [
      'Hours',
      task.hours_expected || task.hours_inverted
        ? `${task.hours_inverted ?? '-'} / ${task.hours_expected ?? '-'}`
        : undefined,
    ],
    ['Assignees', task.assignees?.map((user) => user.name).join(', ')],
    ['Tags', task.tags?.join(', ')],
    ['Comments', task.comments_count],
    ['Description', task.description ? `\n${task.description}` : undefined],
  ]);
}

export const projectsList: Command = {
  path: ['projects', 'list'],
  summary: 'List your projects',
  usage: 'mopux projects list [--search <text>] [--all]',
  options: { search: { type: 'string' }, all: { type: 'boolean' } },
  async run(context, values) {
    const mopux = await context.authenticatedClient();
    const search = str(values, 'search');
    let projects: ProjectSummary[];
    let more = false;
    if (flag(values, 'all')) {
      projects = [];
      for await (const project of mopux.projects.iterate(search === undefined ? {} : { search })) {
        projects.push(project);
      }
    } else {
      const page = await mopux.projects.list({ ...(search === undefined ? {} : { search }), perPage: 50 });
      projects = page.items;
      more = page.hasMore();
    }
    if (context.json) {
      context.printJson(projects);
      return;
    }
    if (projects.length === 0) {
      context.print('No projects.');
      return;
    }
    context.print(
      table(
        ['ID', 'Status', 'Tasks', 'Title'],
        projects.map((p) => [
          p.id,
          projectStatusName(p.status),
          `${p.done_count ?? 0}/${p.tasks_count ?? 0}`,
          truncate(p.title ?? '', 70),
        ]),
      ),
    );
    if (more) {
      context.print('More projects available: use --all or --search.');
    }
  },
};

export const board: Command = {
  path: ['board'],
  summary: 'Show the board of a project: groups and their open tasks',
  usage: 'mopux board <project-id> [--search <text>] [--archived]',
  options: { search: { type: 'string' }, archived: { type: 'boolean' } },
  async run(context, values, args) {
    const projectId = positiveInt(arg(args, 0, 'the project id'), 'project-id');
    const search = str(values, 'search');
    const result = await (await context.authenticatedClient()).projects.board(projectId, {
      ...(search === undefined ? {} : { search }),
      includeArchived: flag(values, 'archived'),
    });
    if (context.json) {
      context.printJson(result);
      return;
    }
    const sections = [`${result.title ?? ''} (#${result.id})`];
    for (const group of result.task_groups ?? []) {
      const archived = group.status === 1 ? ' [archived]' : '';
      sections.push(`\n${group.title} (#${group.id})${archived}: ${group.tasks.length} open`);
      if (group.tasks.length > 0) {
        sections.push(
          table(
            ['ID', 'Status', 'Priority', 'End', 'Assignees', 'Title'],
            group.tasks.map((task) => [
              task.id,
              statusName(task.status),
              priorityName(task.priority),
              task.date_end,
              truncate(task.assignees?.map((user) => user.name).join(', ') ?? '', 30),
              truncate(task.title ?? '', 60),
            ]),
          ),
        );
      }
    }
    context.print(sections.join('\n'));
  },
};

export const tasksMy: Command = {
  path: ['tasks', 'my'],
  summary: 'Your tasks across projects (open ones and those done in the last 15 days)',
  usage: 'mopux tasks my [--search <text>] [--project <id>]...',
  options: { search: { type: 'string' }, project: { type: 'string', multiple: true } },
  async run(context, values) {
    const projectIds = strings(values, 'project').map((value) => positiveInt(value, '--project'));
    const search = str(values, 'search');
    const tasks = await (await context.authenticatedClient()).tasks.my({
      ...(search === undefined ? {} : { search }),
      projectIds,
    });
    if (context.json) {
      context.printJson(tasks);
      return;
    }
    if (tasks.length === 0) {
      context.print('No tasks.');
      return;
    }
    context.print(
      table(
        ['ID', 'Status', 'Priority', 'End', 'Project', 'Title'],
        tasks.map((task) => [
          task.id,
          statusName(task.status),
          priorityName(task.priority),
          task.date_end,
          truncate(task.project?.title ?? '', 30),
          truncate(task.title ?? '', 60),
        ]),
      ),
    );
  },
};

export const taskShow: Command = {
  path: ['task', 'show'],
  summary: 'Show a task',
  usage: 'mopux task show <task-id>',
  async run(context, _values, args) {
    const task = await (await context.authenticatedClient()).tasks.show(
      positiveInt(arg(args, 0, 'the task id'), 'task-id'),
    );
    context.json ? context.printJson(task) : context.print(taskDetails(task));
  },
};

export const taskCreate: Command = {
  path: ['task', 'create'],
  summary: 'Create a task',
  usage:
    'mopux task create --project <id> --group <id> --title <text> [--description <text>] [--priority low|normal|high|max] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--hours HH:MM] [--assign <user-id>]... [--tag <name>]...',
  options: {
    project: { type: 'string' },
    group: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    priority: { type: 'string' },
    start: { type: 'string' },
    end: { type: 'string' },
    hours: { type: 'string' },
    assign: { type: 'string', multiple: true },
    tag: { type: 'string', multiple: true },
  },
  async run(context, values) {
    const title = str(values, 'title');
    if (title === undefined) {
      throw new UsageError('Missing --title.');
    }
    const priority = str(values, 'priority');
    const description = str(values, 'description');
    const start = str(values, 'start');
    const end = str(values, 'end');
    const hours = str(values, 'hours');
    const assignees = strings(values, 'assign').map((value) => positiveInt(value, '--assign'));
    const tags = strings(values, 'tag');
    const task = await (await context.authenticatedClient()).tasks.create({
      project_id: positiveInt(str(values, 'project'), '--project'),
      group_id: positiveInt(str(values, 'group'), '--group'),
      title,
      ...(description === undefined ? {} : { description }),
      ...(priority === undefined ? {} : { priority: parsePriority(priority) }),
      ...(start === undefined ? {} : { date_start: start }),
      ...(end === undefined ? {} : { date_end: end }),
      ...(hours === undefined ? {} : { hours_expected: hours }),
      ...(assignees.length === 0 ? {} : { assignees }),
      ...(tags.length === 0 ? {} : { tags }),
    });
    context.json ? context.printJson(task) : context.print(`Created task #${task.id}: ${task.title}`);
  },
};

export const taskStatus: Command = {
  path: ['task', 'status'],
  summary: 'Change the status of a task',
  usage: 'mopux task status <task-id> <pending|doing|review|done>',
  async run(context, _values, args) {
    const taskId = positiveInt(arg(args, 0, 'the task id'), 'task-id');
    const status = parseStatus(arg(args, 1, 'the status (pending, doing, review or done)'));
    const task = await (await context.authenticatedClient()).tasks.updateStatus(taskId, status);
    context.json ? context.printJson(task) : context.print(`Task #${task.id} is now ${statusName(task.status)}.`);
  },
};

export const taskComment: Command = {
  path: ['task', 'comment'],
  summary: 'Comment on a task, optionally with files',
  usage: 'mopux task comment <task-id> [text] [--file <path>]...',
  options: { file: { type: 'string', multiple: true } },
  async run(context, values, args) {
    const taskId = positiveInt(arg(args, 0, 'the task id'), 'task-id');
    const text = args.slice(1).join(' ').trim();
    const files = await Promise.all(strings(values, 'file').map((path) => Upload.fromPath(path)));
    if (text === '' && files.length === 0) {
      throw new UsageError('Write a comment or attach a file with --file.');
    }
    const comment = await (await context.authenticatedClient()).comments.create(taskId, {
      ...(text === '' ? {} : { comment: text }),
      files,
    });
    context.json ? context.printJson(comment) : context.print(`Comment #${comment.id} added to task #${taskId}.`);
  },
};

export const notifications: Command = {
  path: ['notifications'],
  summary: 'List your notifications, or mark them all as read',
  usage: 'mopux notifications [--unread] [--read-all] [--limit <n>]',
  options: { unread: { type: 'boolean' }, 'read-all': { type: 'boolean' }, limit: { type: 'string' } },
  async run(context, values) {
    const mopux = await context.authenticatedClient();
    if (flag(values, 'read-all')) {
      await mopux.notifications.markAllRead();
      context.json ? context.printJson({ unread_count: 0 }) : context.print('All notifications marked as read.');
      return;
    }
    const limit = str(values, 'limit') === undefined ? 20 : positiveInt(str(values, 'limit'), '--limit');
    const page = await mopux.notifications.list({
      filter: flag(values, 'unread') ? 'unread' : 'all',
      perPage: Math.min(limit, 100),
    });
    if (context.json) {
      context.printJson(page.items);
      return;
    }
    if (page.items.length === 0) {
      context.print('No notifications.');
      return;
    }
    context.print(
      table(
        ['', 'Date', 'Title'],
        page.items.map((item) => [
          item.is_read ? '' : '•',
          item.created_at,
          truncate(item.title ?? item.message ?? '', 80),
        ]),
      ),
    );
  },
};
