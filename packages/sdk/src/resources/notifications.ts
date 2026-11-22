import { InvalidInputError } from '../errors.js';
import { Page } from '../page.js';
import type { Notification, QueryParams } from '../types.js';
import * as v from '../validate.js';
import { Resource } from './resource.js';

export interface NotificationListOptions {
  filter?: QueryParams<'notificationsList'>['filter'];
  page?: number;
  perPage?: number;
}

export class Notifications extends Resource {
  /** Notifications of the user, newest first. */
  async list(options: NotificationListOptions = {}): Promise<Page<Notification>> {
    const page = v.page(options.page ?? 1);
    const perPage = v.perPage(options.perPage ?? 25);
    const response = await this.connector.get('notifications', { filter: options.filter, page, per_page: perPage });
    return Page.from<Notification>(response.data, page, perPage);
  }

  iterate(options: Omit<NotificationListOptions, 'page'> = {}): AsyncGenerator<Notification> {
    return Page.iterate((page) => this.list({ ...options, page, perPage: options.perPage ?? 100 }));
  }

  async markRead(notificationId: string): Promise<Notification> {
    return (await this.connector.patch(path(notificationId, 'read'))).data as Notification;
  }

  async markUnread(notificationId: string): Promise<Notification> {
    return (await this.connector.patch(path(notificationId, 'unread'))).data as Notification;
  }

  /** Marks everything as read and returns the unread count (0). */
  async markAllRead(): Promise<number> {
    return count((await this.connector.patch('notifications/read-all')).data, 'unread_count');
  }

  async unreadCount(): Promise<number> {
    return count((await this.connector.get('notifications/badge')).data, 'unread_count');
  }

  /** Deletes a notification and returns the remaining unread count. */
  async delete(notificationId: string): Promise<number> {
    return count((await this.connector.delete(path(notificationId))).data, 'unread_count');
  }

  /** Deletes every notification of the user and returns how many were deleted. */
  async deleteAll(): Promise<number> {
    return count((await this.connector.delete('notifications')).data, 'deleted');
  }
}

function path(notificationId: string, suffix = ''): string {
  if (!/^[0-9a-f-]{36}$/i.test(notificationId)) {
    throw new InvalidInputError('notificationId', 'expected a UUID.');
  }
  return `notifications/${notificationId}${suffix === '' ? '' : `/${suffix}`}`;
}

function count(data: unknown, key: string): number {
  const value = (data as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' ? value : 0;
}
