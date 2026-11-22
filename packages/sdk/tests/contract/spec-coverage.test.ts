import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { Mopux, Upload } from '../../src/index.js';
import { MockFetch } from '../../src/testing/index.js';

/*
 * Contract between the SDK and spec/openapi.yaml (copy of mopux-com/docs/api/openapi-v1-public.yaml,
 * refreshed with `npm run sync-spec`). Every operation of the spec maps to an SDK call; each call runs
 * against MockFetch and must hit the method and path of the operation. The test fails when the API
 * gains an operation the SDK does not cover, or when a mapped call hits the wrong endpoint.
 */

const UUID = '9b2f6a3e-1c1d-4e8f-9f0a-6f1d2c3b4a5e';

const operations: Record<string, (m: Mopux) => Promise<unknown>> = {
  'POST /api/v1/auth/login': (m) => m.auth.login('ada@acme.test', 'secret'),
  'POST /api/v1/auth/logout': (m) => m.auth.logout(),
  'GET /api/v1/auth/user': (m) => m.auth.user(),
  'GET /api/v1/auth/tokens': (m) => m.auth.tokens.list(),
  'DELETE /api/v1/auth/tokens/{tokenId}': (m) => m.auth.tokens.delete(9),

  'GET /api/v1/projects': (m) => m.projects.list(),
  'POST /api/v1/projects': (m) => m.projects.create({ title: 'Web' }),
  'GET /api/v1/projects/{projectId}': (m) => m.projects.show(12),
  'PATCH /api/v1/projects/{projectId}': (m) => m.projects.update(12, { status: 1 }),
  'DELETE /api/v1/projects/{projectId}': (m) => m.projects.delete(12, 'web'),
  'GET /api/v1/projects/{projectId}/activity': (m) => m.projects.activity(12),
  'GET /api/v1/projects/{projectId}/members': (m) => m.projects.members(12),
  'POST /api/v1/projects/{projectId}/members': (m) => m.projects.addMember(12, 5),
  'DELETE /api/v1/projects/{projectId}/members/{userId}': (m) => m.projects.removeMember(12, 5),
  'GET /api/v1/projects/{projectId}/summary': (m) => m.projects.summary(12),
  'GET /api/v1/projects/{projectId}/board': (m) => m.projects.board(12),

  'POST /api/v1/projects/{projectId}/task-groups': (m) => m.taskGroups.create(12, 'Backlog'),
  'PATCH /api/v1/projects/{projectId}/task-groups/reorder': (m) => m.taskGroups.reorder(12, [8, 7]),
  'PATCH /api/v1/projects/{projectId}/task-groups/{taskGroupId}/tasks/reorder': (m) =>
    m.taskGroups.reorderTasks(12, 7, [101]),
  'PATCH /api/v1/projects/{projectId}/task-groups/{taskGroupId}/title': (m) => m.taskGroups.rename(12, 7, 'Renamed'),
  'PATCH /api/v1/projects/{projectId}/task-groups/{taskGroupId}/archive': (m) => m.taskGroups.archive(12, 7),
  'PATCH /api/v1/projects/{projectId}/task-groups/{taskGroupId}/unarchive': (m) => m.taskGroups.unarchive(12, 7),
  'PATCH /api/v1/projects/{projectId}/task-groups/{taskGroupId}/move': (m) => m.taskGroups.move(12, 7, 13),
  'PATCH /api/v1/projects/{projectId}/task-groups/{taskGroupId}/copy': (m) => m.taskGroups.copy(12, 7, 13, 'Copy'),
  'POST /api/v1/projects/{projectId}/task-groups/{taskGroupId}/create-project': (m) =>
    m.taskGroups.createProject(12, 7, 'Spin-off'),
  'DELETE /api/v1/projects/{projectId}/task-groups/{taskGroupId}': (m) => m.taskGroups.delete(12, 7),
  'GET /api/v1/projects/{projectId}/task-groups/{taskGroupId}/focus': (m) => m.taskGroups.focus(12, 7),
  'GET /api/v1/projects/{projectId}/task-groups/{taskGroupId}/status-summary': (m) => m.taskGroups.statusSummary(12, 7),

  'POST /api/v1/tasks': (m) => m.tasks.create({ project_id: 12, group_id: 7, title: 'x' }),
  'PATCH /api/v1/tasks/batch': (m) => m.tasks.updateBatch([{ id: 101, changes: { task_group_id: 8 } }]),
  'GET /api/v1/tasks/my': (m) => m.tasks.my(),
  'GET /api/v1/tasks/markdown-help': (m) => m.tasks.markdownHelp(),
  'GET /api/v1/tasks/focus': (m) => m.tasks.focus(),
  'POST /api/v1/tasks/{taskId}/focus': (m) => m.tasks.pinFocus(101),
  'DELETE /api/v1/tasks/{taskId}/focus': (m) => m.tasks.unpinFocus(101),
  'GET /api/v1/tasks/{taskId}/move-options': (m) => m.tasks.moveOptions(101),
  'GET /api/v1/tasks/{taskId}/attachments': (m) => m.tasks.attachments(101),
  'POST /api/v1/tasks/{taskId}/files': (m) => m.tasks.uploadFile(101, Upload.from('x', 'a.txt')),
  'DELETE /api/v1/tasks/{taskId}/files/{mediaId}': (m) => m.tasks.deleteFile(101, 77),
  'GET /api/v1/tasks/{taskId}': (m) => m.tasks.show(101),
  'PATCH /api/v1/tasks/{taskId}': (m) => m.tasks.update(101, { title: 'x' }),
  'DELETE /api/v1/tasks/{taskId}': (m) => m.tasks.delete(101),
  'PATCH /api/v1/tasks/{taskId}/status': (m) => m.tasks.updateStatus(101, 3),
  'PATCH /api/v1/tasks/{taskId}/priority': (m) => m.tasks.updatePriority(101, 2),
  'PATCH /api/v1/tasks/{taskId}/assign': (m) => m.tasks.assign(101, 5),
  'PATCH /api/v1/tasks/{taskId}/move': (m) => m.tasks.move(101, 13, 20),
  'PATCH /api/v1/tasks/{taskId}/title': (m) => m.tasks.updateTitle(101, 'x'),
  'PATCH /api/v1/tasks/{taskId}/description': (m) => m.tasks.updateDescription(101, 'x'),
  'PATCH /api/v1/tasks/{taskId}/start': (m) => m.tasks.updateStart(101, '2026-11-20'),
  'PATCH /api/v1/tasks/{taskId}/end': (m) => m.tasks.updateEnd(101, '2026-11-30'),
  'PATCH /api/v1/tasks/{taskId}/hours': (m) => m.tasks.updateHours(101, { expected: '1:00' }),
  'POST /api/v1/tasks/{taskId}/touches': (m) => m.tasks.sendTouch(101, 5),

  'GET /api/v1/tasks/{taskId}/comments': (m) => m.comments.list(101),
  'POST /api/v1/tasks/{taskId}/comments': (m) => m.comments.create(101, 'Hola'),
  'PATCH /api/v1/comments/{commentId}': (m) => m.comments.update(55, 'x'),
  'DELETE /api/v1/comments/{commentId}': (m) => m.comments.delete(55),
  'POST /api/v1/comments/{commentId}/reply': (m) => m.comments.reply(55, 'x'),

  'GET /api/v1/notifications': (m) => m.notifications.list(),
  'PATCH /api/v1/notifications/{notificationId}/read': (m) => m.notifications.markRead(UUID),
  'PATCH /api/v1/notifications/{notificationId}/unread': (m) => m.notifications.markUnread(UUID),
  'PATCH /api/v1/notifications/read-all': (m) => m.notifications.markAllRead(),
  'GET /api/v1/notifications/badge': (m) => m.notifications.unreadCount(),
  'DELETE /api/v1/notifications': (m) => m.notifications.deleteAll(),
  'DELETE /api/v1/notifications/{notificationId}': (m) => m.notifications.delete(UUID),

  'GET /api/v1/touches': (m) => m.touches.list(),
  'POST /api/v1/touches/{touchId}/reply': (m) => m.touches.reply(4, 'Hecho'),

  'GET /api/v1/team': (m) => m.team.list(),
  'GET /api/v1/team/invitations': (m) => m.teamInvitations.list(),
  'POST /api/v1/team/invitations': (m) => m.teamInvitations.create('new@acme.test', 2),
  'POST /api/v1/team/invitations/{invitationId}/resend': (m) => m.teamInvitations.resend(2),
  'DELETE /api/v1/team/invitations/{invitationId}': (m) => m.teamInvitations.delete(2),
};

function specOperations(): string[] {
  const spec = parse(readFileSync(new URL('../../spec/openapi.yaml', import.meta.url), 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  return Object.entries(spec.paths)
    .flatMap(([path, methods]) =>
      Object.keys(methods)
        .filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    )
    .sort();
}

function matches(template: string, path: string): boolean {
  const pattern = template.replace(/^\/api\/v1\//, '').replace(/\{[^}]+\}/g, '[^/]+');
  return new RegExp(`^${pattern}$`).test(path);
}

describe('spec coverage', () => {
  it('maps every operation of the spec, and only those', () => {
    expect(Object.keys(operations).sort()).toEqual(specOperations());
    expect(specOperations()).toHaveLength(71);
  });

  it.each(Object.entries(operations))('%s hits the documented endpoint', async (operation, call) => {
    const [method, template] = operation.split(' ') as [string, string];
    const mock = new MockFetch().always(MockFetch.json({}));
    await call(new Mopux({ baseUrl: 'https://acme.test', token: 't', fetch: mock.fetch }));

    expect(mock.requests).toHaveLength(1);
    const [request] = mock.requests;
    expect(request?.method).toBe(method);
    expect(matches(template, request?.path ?? '')).toBe(true);
  });
});
