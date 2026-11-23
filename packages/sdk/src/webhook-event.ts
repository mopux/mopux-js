import { InvalidWebhookPayloadError, isRecord } from './errors.js';
import type { components, webhooks } from './generated/openapi.js';
import type { TaskDetail } from './types.js';

export const WebhookEventType = {
  TaskCreated: 'task.created',
  TaskCompleted: 'task.completed',
  TaskStatusChanged: 'task.status_changed',
  TaskAssigned: 'task.assigned',
  TaskUpdated: 'task.updated',
  TaskMoved: 'task.moved',
  TaskDeleted: 'task.deleted',
  Ping: 'ping',
} as const satisfies Record<string, keyof webhooks>;

export type WebhookEventType = keyof webhooks;
type Envelope = components['schemas']['WebhookEnvelope'];
type Change = components['schemas']['WebhookChange'];
type Payload = Record<string, unknown>;

export type WebhookEventData<E extends string> = E extends WebhookEventType
  ? NonNullable<webhooks[E]['post']['requestBody']['content']['application/json']['data']> & Payload
  : Payload;

function string(value: unknown, field: string): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  throw new InvalidWebhookPayloadError(field, 'expected a string');
}

function integer(value: unknown, field: string): number {
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (typeof number === 'number' && Number.isSafeInteger(number)) return number;
  throw new InvalidWebhookPayloadError(field, 'expected an integer');
}

function nullable<T>(value: unknown, field: string, read: (value: unknown, field: string) => T): T | null {
  return value == null ? null : read(value, field);
}

function list(value: unknown, field: string): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value) || isRecord(value)) return Object.values(value);
  throw new InvalidWebhookPayloadError(field, 'expected a list');
}

function object(value: unknown, field: string): Payload {
  if (isRecord(value)) return value;
  throw new InvalidWebhookPayloadError(field, 'expected a JSON object');
}

function uuid(value: unknown, field: string): string {
  if (typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) return value;
  throw new InvalidWebhookPayloadError(field, 'expected a UUID');
}

function occurredAt(value: unknown): string {
  const source = string(value, 'webhook.occurred_at');
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/.exec(source);
  if (match) {
    const seconds = new Date(`${match[1]}Z`);
    if (Number.isFinite(seconds.getTime()) && seconds.toISOString().slice(0, 19) === match[1]) return source;
  }
  throw new InvalidWebhookPayloadError('webhook.occurred_at', 'expected a valid ISO-8601 UTC timestamp ending in Z');
}

type Actor = (Omit<NonNullable<Envelope['actor']>, 'via'> & { via: string }) | null;

function actor(value: unknown): Actor {
  if (value === null) return null;
  const fields = object(value, 'webhook.actor');
  return {
    id: integer(fields.id, 'webhook.actor.id'),
    name: string(fields.name, 'webhook.actor.name'),
    via: string(fields.via, 'webhook.actor.via'),
  };
}

export class WebhookEvent<E extends string = string> {
  private constructor(
    readonly id: string,
    readonly deliveryId: string,
    readonly event: E,
    readonly occurredAt: string,
    readonly installation: string,
    readonly actor: Actor,
    readonly data: WebhookEventData<E>,
  ) {}

  /** Narrow the event name and its data to the shape declared in the OpenAPI spec. */
  is<T extends WebhookEventType>(type: T): this is this & WebhookEvent<T> {
    return this.event === (type as string);
  }

  /** Validated event envelope. Read task details through the accessors as needed. */
  static fromVerifiedPayload(payload: unknown, eventHeader: string, deliveryHeader: string): WebhookEvent {
    const body = object(payload, 'webhook');
    const event = string(body.event, 'webhook.event');
    if (event === '' || eventHeader !== event) {
      throw new InvalidWebhookPayloadError('X-Mopux-Event', 'expected a single header matching the body event');
    }
    const eventActor = actor(body.actor);
    const data = object(body.data, 'webhook.data');
    return new WebhookEvent(
      uuid(body.id, 'webhook.id'),
      uuid(deliveryHeader, 'X-Mopux-Delivery'),
      event,
      occurredAt(body.occurred_at),
      string(body.installation, 'webhook.installation'),
      eventActor,
      data,
    );
  }

  task(): TaskDetail | null {
    if (this.data.task == null) return null;
    const task = object(this.data.task, 'webhook.data.task');
    if (task.deleted === true) return null;
    const id = integer(task.id, 'webhook.data.task.id');
    const title = string(task.title, 'webhook.data.task.title');
    const status = integer(task.status, 'webhook.data.task.status');
    if (status !== -1 && status !== 0 && status !== 1 && status !== 2 && status !== 3) {
      throw new InvalidWebhookPayloadError('webhook.data.task.status', 'expected a task status');
    }
    const parsed: TaskDetail = { ...task, id, title, status };
    const priority = nullable(task.priority, 'webhook.data.task.priority', integer) ?? 0;
    if (priority !== 0 && priority !== 1 && priority !== 2 && priority !== 9) {
      throw new InvalidWebhookPayloadError('webhook.data.task.priority', 'expected a task priority');
    }
    if (Object.hasOwn(task, 'priority')) parsed.priority = priority;

    for (const key of ['description', 'hours_expected', 'hours_inverted'] as const) {
      if (Object.hasOwn(task, key)) parsed[key] = nullable(task[key], `webhook.data.task.${key}`, string);
    }
    for (const key of ['assigned_to', 'comments_count', 'medias_count'] as const) {
      if (Object.hasOwn(task, key)) parsed[key] = nullable(task[key], `webhook.data.task.${key}`, integer);
    }
    for (const key of ['date_start', 'date_end', 'created_at', 'updated_at'] as const) {
      if (!Object.hasOwn(task, key)) continue;
      const field = `webhook.data.task.${key}`;
      const date = nullable(task[key], field, string);
      if (date && !Number.isFinite(Date.parse(date))) {
        throw new InvalidWebhookPayloadError(field, 'expected a date');
      }
      parsed[key] = date || null;
    }
    for (const key of ['project', 'group'] as const) {
      if (task[key] == null) {
        delete parsed[key];
        continue;
      }
      const field = `webhook.data.task.${key}`;
      const ref = object(task[key], field);
      parsed[key] = {
        ...ref,
        id: nullable(ref.id, `${field}.id`, integer),
        title: nullable(ref.title, `${field}.title`, string),
      };
    }
    if (Object.hasOwn(task, 'assignees')) {
      parsed.assignees = list(task.assignees, 'webhook.data.task.assignees').map((value, index) => {
        const field = `webhook.data.task.assignees.${index}`;
        const user = object(value, field);
        return {
          ...user,
          id: integer(user.id, `${field}.id`),
          name: nullable(user.name, `${field}.name`, string),
          avatar: nullable(user.avatar, `${field}.avatar`, string),
        };
      });
    }
    if (Object.hasOwn(task, 'tags')) {
      parsed.tags = list(task.tags, 'webhook.data.task.tags').map((value, index) =>
        string(value, `webhook.data.task.tags.${index}`),
      );
    }
    return parsed;
  }

  previousStatus(): number | null {
    return this.optionalInteger('previous_status');
  }

  changes(): Record<string, Change> {
    const changes = this.data.changes;
    if (changes == null || (Array.isArray(changes) && changes.length === 0)) return {};
    return Object.fromEntries(
      Object.entries(object(changes, 'webhook.data.changes')).map(([field, change]) => {
        if (
          /^(?:0|-?[1-9]\d*)$/.test(field) ||
          !isRecord(change) ||
          !Object.hasOwn(change, 'old') ||
          !Object.hasOwn(change, 'new')
        ) {
          throw new InvalidWebhookPayloadError(
            'webhook.data.changes',
            'expected field names mapped to old and new values',
          );
        }
        return [field, { old: change.old, new: change.new }];
      }),
    );
  }

  assignedUserIds(): number[] {
    return list(this.data.assigned_user_ids, 'webhook.data.assigned_user_ids').map((value, index) =>
      integer(value, `webhook.data.assigned_user_ids.${index}`),
    );
  }

  previousProjectId(): number | null {
    return this.optionalInteger('previous_project_id');
  }

  previousGroupId(): number | null {
    return this.optionalInteger('previous_group_id');
  }

  private optionalInteger(field: string): number | null {
    const value = this.data[field];
    return value == null ? null : integer(value, `webhook.data.${field}`);
  }
}
