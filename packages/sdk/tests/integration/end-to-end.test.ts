import { describe, expect, it } from 'vitest';
import { Mopux, NotFoundError, Upload } from '../../src/index.js';

/*
 * Runs the whole API flow against a real installation. Skipped unless MOPUX_INTEGRATION_URL and
 * MOPUX_INTEGRATION_TOKEN (or MOPUX_INTEGRATION_EMAIL and MOPUX_INTEGRATION_PASSWORD) are set:
 *
 *   MOPUX_INTEGRATION_URL=https://acme.mopux.test MOPUX_INTEGRATION_TOKEN=… npm run test:integration
 *
 * It creates a temporary project and deletes it at the end. MOPUX_INTEGRATION_UPLOADS=1 also
 * exercises file uploads (needs working storage). Use a local or staging installation, never
 * production.
 */

const env = process.env;
const configured =
  Boolean(env.MOPUX_INTEGRATION_URL) &&
  (Boolean(env.MOPUX_INTEGRATION_TOKEN) ||
    (Boolean(env.MOPUX_INTEGRATION_EMAIL) && Boolean(env.MOPUX_INTEGRATION_PASSWORD)));

async function client(): Promise<Mopux> {
  const options = { baseUrl: env.MOPUX_INTEGRATION_URL ?? '', userAgent: 'mopux-js-integration-tests' };
  if (env.MOPUX_INTEGRATION_TOKEN) {
    return new Mopux({ ...options, token: env.MOPUX_INTEGRATION_TOKEN });
  }
  return Mopux.login({
    ...options,
    email: env.MOPUX_INTEGRATION_EMAIL ?? '',
    password: env.MOPUX_INTEGRATION_PASSWORD ?? '',
    tokenName: 'mopux-js-integration',
  });
}

describe.skipIf(!configured)('integration', () => {
  it('runs the whole API flow against a real installation', { timeout: 120_000 }, async () => {
    const mopux = await client();
    let projectId: number | null = null;

    try {
      const me = await mopux.auth.user();
      expect(me.id).toBeGreaterThan(0);
      await mopux.projects.list({ perPage: 5 });
      await mopux.tasks.my();
      await mopux.tasks.focus();
      await mopux.tasks.markdownHelp();
      // auth/tokens arrived in API 1.2.
      await mopux.auth.tokens.list().catch((error: unknown) => {
        if (!(error instanceof NotFoundError)) {
          throw error;
        }
      });
      await mopux.notifications.list({ perPage: 5 });
      await mopux.notifications.unreadCount();

      const project = await mopux.projects.create({
        title: `mopux-js ${new Date().toISOString()}`,
        description: 'Created by the mopux-js integration tests',
      });
      projectId = project.id ?? null;
      expect(projectId).not.toBeNull();
      const id = projectId as number;

      await mopux.projects.update(id, { description: 'Updated by mopux-js' });
      expect((await mopux.projects.members(id)).some((member) => member.id === me.id)).toBe(true);

      const group = await mopux.taskGroups.create(id, 'Backlog', [{ title: 'First task' }, { title: 'Second task' }]);
      expect(Number(group.status)).toBe(0); // API 1.1 answered false here
      expect(group.tasks).toHaveLength(2);

      let task = await mopux.tasks.create({
        project_id: id,
        group_id: group.id as number,
        title: 'Third task',
        hours_expected: '1:30',
        assignees: [me.id as number],
        tags: ['sdk'],
      });
      expect(task.hours_expected).toBe('01:30:00');

      task = await mopux.tasks.update(task.id as number, {
        date_start: '2026-12-01',
        date_end: '2026-12-15',
        assignees: { operation: 'replace', user_ids: [me.id as number] },
      });
      task = await mopux.tasks.updateStatus(task.id as number, 2);
      task = await mopux.tasks.updatePriority(task.id as number, 9);
      task = await mopux.tasks.updateTitle(task.id as number, 'Third task (renamed)');
      task = await mopux.tasks.updateDescription(task.id as number, null);
      task = await mopux.tasks.updateHours(task.id as number, { expected: '2:00' });
      expect(task.title).toBe('Third task (renamed)');

      await mopux.tasks.updateBatch([{ id: group.tasks[0]?.id as number, changes: { priority: 2 } }]);
      await expect(
        mopux.tasks.create({ project_id: id, group_id: group.id as number, title: 'Bad', assignees: [999_999_999] }),
      ).rejects.toBeInstanceOf(Error);

      const board = await mopux.projects.board(id);
      expect(board.task_groups?.length).toBeGreaterThan(0);
      const summary = await mopux.taskGroups.statusSummary(id, group.id as number);
      expect(summary.summary?.total).toBeTypeOf('number');
      await mopux.taskGroups.focus(id, group.id as number);
      await mopux.projects.summary(id);
      await mopux.projects.activity(id, { perPage: 10 });
      await mopux.taskGroups.reorderTasks(id, group.id as number, [task.id as number]);
      expect((await mopux.taskGroups.rename(id, group.id as number, 'Backlog (renamed)')).title).toBe(
        'Backlog (renamed)',
      );

      const comment = await mopux.comments.create(task.id as number, {
        comment: 'Hello from mopux-js',
        mentions: [me.id as number],
      });
      const reply = await mopux.comments.reply(comment.id as number, 'A reply');
      await mopux.comments.update(comment.id as number, 'Hello from mopux-js (edited)');
      const comments = await mopux.comments.list(task.id as number);
      expect(comments.items.length).toBeGreaterThanOrEqual(2);

      if (env.MOPUX_INTEGRATION_UPLOADS === '1') {
        await mopux.comments.create(task.id as number, {
          comment: 'With a file',
          files: [Upload.from('a,b\n1,2\n', 'sdk-test.csv', 'text/csv')],
        });
        const attachment = await mopux.tasks.uploadFile(
          task.id as number,
          Upload.from('plain text', 'sdk-direct.txt', 'text/plain'),
        );
        expect((await mopux.tasks.attachments(task.id as number)).items.length).toBeGreaterThan(0);
        await mopux.tasks.deleteFile(task.id as number, attachment.id as number);
      }
      await mopux.comments.delete(reply.id as number);

      await mopux.tasks.moveOptions(task.id as number);
      expect((await mopux.taskGroups.archive(id, group.id as number)).status).toBe(1);
      expect((await mopux.taskGroups.unarchive(id, group.id as number)).status).toBe(0);

      await mopux.tasks.delete(task.id as number);
      await expect(mopux.tasks.show(task.id as number)).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      if (projectId !== null) {
        const slug = (await mopux.projects.show(projectId)).slug;
        if (slug) {
          await mopux.projects.delete(projectId, slug);
        }
      }
      if (!env.MOPUX_INTEGRATION_TOKEN) {
        await mopux.auth.logout();
      }
    }
  });
});
