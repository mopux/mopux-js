import { InvalidInputError } from '../errors.js';
import { Page } from '../page.js';
import type { Comment } from '../types.js';
import type { Upload } from '../upload.js';
import * as v from '../validate.js';
import { Resource } from './resource.js';

export interface CommentInput {
  /** Markdown text. Mentions in the text (`@Name#id`) are resolved by the API. */
  comment?: string | null;
  /** Ids of project members to mention. */
  mentions?: number[];
  /** Ids of documents already uploaded to the task. */
  mediaIds?: number[];
  /** Files to upload and attach (sent as multipart). */
  files?: Upload[];
}

export class Comments extends Resource {
  /** Comments of a task, newest first. */
  async list(taskId: number, options: { page?: number; perPage?: number } = {}): Promise<Page<Comment>> {
    const page = v.page(options.page ?? 1);
    const perPage = v.perPage(options.perPage ?? 20);
    const response = await this.connector.get(taskPath(taskId), { page, per_page: perPage });
    return Page.from<Comment>(response.data, page, perPage);
  }

  iterate(taskId: number, options: { perPage?: number } = {}): AsyncGenerator<Comment> {
    return Page.iterate((page) => this.list(taskId, { page, perPage: options.perPage ?? 100 }));
  }

  /** Publishes a comment. With files the request is multipart and the files go to the task. */
  async create(taskId: number, input: CommentInput | string): Promise<Comment> {
    const comment = typeof input === 'string' ? { comment: input } : input;
    const mentions = v.ids(comment.mentions ?? [], 'mentions');
    const mediaIds = v.ids(comment.mediaIds ?? [], 'mediaIds');
    const files = comment.files ?? [];
    const text = comment.comment ?? null;
    if ((text === null || text.trim() === '') && mentions.length === 0 && mediaIds.length === 0 && files.length === 0) {
      throw new InvalidInputError('comment', 'a comment, files, documents or mentions are required.');
    }

    if (files.length === 0) {
      const body = {
        ...(text === null ? {} : { comment: text }),
        ...(mentions.length === 0 ? {} : { mentions }),
        ...(mediaIds.length === 0 ? {} : { media_ids: mediaIds }),
      };
      return (await this.connector.post(taskPath(taskId), body)).data as Comment;
    }

    const form = new FormData();
    if (text !== null) {
      form.append('comment', text);
    }
    for (const id of mentions) {
      form.append('mentions[]', String(id));
    }
    for (const id of mediaIds) {
      form.append('media_ids[]', String(id));
    }
    for (const file of files) {
      form.append('files[]', file.blob, file.filename);
    }
    return (await this.connector.request('POST', taskPath(taskId), { form })).data as Comment;
  }

  /** Edits the text of a comment of the user. */
  async update(commentId: number, comment: string): Promise<Comment> {
    return (await this.connector.patch(path(commentId), { comment: v.text(comment, 'comment') })).data as Comment;
  }

  /** Deletes a comment of the user. Its files stay in the task unless `keepFiles` is false. */
  async delete(commentId: number, options: { keepFiles?: boolean } = {}): Promise<void> {
    await this.connector.delete(
      path(commentId),
      options.keepFiles === undefined ? {} : { query: { keep_files: options.keepFiles } },
    );
  }

  async reply(commentId: number, comment: string): Promise<Comment> {
    const response = await this.connector.post(path(commentId, 'reply'), { comment: v.text(comment, 'comment') });
    return response.data as Comment;
  }
}

function taskPath(taskId: number): string {
  return `tasks/${v.id(taskId, 'taskId')}/comments`;
}

function path(commentId: number, suffix = ''): string {
  return `comments/${v.id(commentId, 'commentId')}${suffix === '' ? '' : `/${suffix}`}`;
}
