import { createHmac } from 'node:crypto';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  InvalidWebhookPayloadError,
  InvalidWebhookSignatureError,
  parseWebhookEvent,
  verifyWebhookSignature,
  WebhookEventType,
} from '../../src/index.js';
import { verifyWebhookSignature as verifyWithGlobalCrypto } from '../../src/webhooks.js';
import events from '../fixtures/webhooks/events.json' with { type: 'json' };
import signatures from '../fixtures/webhooks/signature-vectors.json' with { type: 'json' };
import taskDetail from '../fixtures/webhooks/task_detail.json' with { type: 'json' };

const delivery = '00000000-0000-4000-8000-000000000002';
const secret = 'test';

function signedHeaders(body: string | Uint8Array, event = 'ping') {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
  return {
    'X-mOPUX-eVENT': event,
    'x-mopux-delivery': delivery,
    'X-MOPUX-SIGNATURE': `t=${timestamp},v1=${digest}`,
  };
}

describe('verifyWebhookSignature', () => {
  it.each(signatures.vectors)(
    'matches the PHP vector at $timestamp',
    async ({ body, signature, secret, timestamp }) => {
      const bytes = new TextEncoder().encode(body);
      await expect(verifyWebhookSignature(body, signature, secret, { now: timestamp })).resolves.toBeUndefined();
      await expect(
        verifyWithGlobalCrypto(bytes.buffer, signature, secret, { now: timestamp }),
      ).resolves.toBeUndefined();
      for (const skew of [-300, 300]) {
        await expect(
          verifyWebhookSignature(bytes, signature, secret, { now: timestamp + skew }),
        ).resolves.toBeUndefined();
        await expect(
          verifyWebhookSignature(body, signature, secret, { now: timestamp + skew, tolerance: 299 }),
        ).rejects.toThrow(/outside/);
      }
      for (const skew of [-301, 301]) {
        await expect(verifyWebhookSignature(body, signature, secret, { now: timestamp + skew })).rejects.toThrow(
          /outside/,
        );
      }
      await expect(verifyWebhookSignature(`${body}\n`, signature, secret, { now: timestamp })).rejects.toThrow(/match/);
      await expect(verifyWebhookSignature(body, signature, `${secret}x`, { now: timestamp })).rejects.toThrow(/match/);
      await expect(verifyWebhookSignature(body, signature, '', { now: timestamp })).rejects.toThrow(/match/);
    },
  );

  const hex = 'a'.repeat(64);
  it.each([
    '',
    'v1=abc',
    't=123,v1=abc',
    `t=1,t=2,v1=${hex}`,
    `t=999999999999999999999999,v1=${hex}`,
    `t=0001,v1=${hex}`,
    `t=1,v1=${hex.toUpperCase()}`,
    `t=1,v1=${hex}\n`,
  ])('rejects malformed header %j', async (header) => {
    await expect(verifyWebhookSignature('{}', header, secret)).rejects.toThrow(/Malformed/);
  });
});

describe('parseWebhookEvent', () => {
  it.each(Object.entries(events.events))('parses %s', async (name, fixture) => {
    const task = name.startsWith('task.') && name !== 'task.deleted' ? taskDetail : null;
    const data = task ? { ...fixture, task } : fixture;
    const envelope = { ...events.envelope, actor: name === 'ping' ? null : events.envelope.actor };
    const body = Buffer.from(JSON.stringify({ ...envelope, event: name, data }));
    const event = await parseWebhookEvent(body, new Headers(signedHeaders(body, name)), secret);
    expect(event).toMatchObject({
      id: envelope.id,
      event: name,
      deliveryId: delivery,
      occurredAt: envelope.occurred_at,
      installation: envelope.installation,
      actor: envelope.actor,
      data,
    });
    expect(event.task()).toEqual(task);
    expect(event.previousStatus()).toEqual('previous_status' in data ? data.previous_status : null);
    expect(event.changes()).toEqual('changes' in data ? data.changes : {});
    expect(event.assignedUserIds()).toEqual('assigned_user_ids' in data ? data.assigned_user_ids : []);
    expect(event.previousProjectId()).toEqual('previous_project_id' in data ? data.previous_project_id : null);
    expect(event.previousGroupId()).toEqual('previous_group_id' in data ? data.previous_group_id : null);
    if (event.is(WebhookEventType.Ping)) {
      expectTypeOf(event.data.message).toEqualTypeOf<string | undefined>();
      expect(event.data.message).toBe('Mopux webhook test');
    }
  });

  it('keeps a reduced task on an earlier task event', async () => {
    const event = 'task.updated';
    const data = events.events['task.deleted'];
    const body = JSON.stringify({ ...events.envelope, event, data });
    const parsed = await parseWebhookEvent(body, signedHeaders(body, event), secret);
    expect(parsed.task()).toBeNull();
    expect(parsed.data).toEqual(data);
  });

  it('verifies bytes before parsing JSON', async () => {
    await expect(parseWebhookEvent('{', signedHeaders('{'), 'wrong')).rejects.toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
    await expect(parseWebhookEvent('{', signedHeaders('{'), secret)).rejects.toBeInstanceOf(InvalidWebhookPayloadError);
    const body = new Uint8Array([0xff]);
    await expect(parseWebhookEvent(body, signedHeaders(body), secret)).rejects.toBeInstanceOf(
      InvalidWebhookPayloadError,
    );
  });

  it('parses the same bytes that were verified even if the caller mutates its buffer', async () => {
    const body = Buffer.from(JSON.stringify({ ...events.envelope, event: 'ping', data: {} }));
    const parsed = parseWebhookEvent(body, signedHeaders(body), secret);
    body.fill(0);
    await expect(parsed).resolves.toMatchObject({ event: 'ping' });
  });

  it.each([
    ['id', 'invalid'],
    ['actor', undefined],
    ['actor', { id: 'NaN', name: 'Ada', via: 'api' }],
    ['data', ['invalid']],
    ['occurred_at', '2026-02-30T12:00:00Z'],
    ['occurred_at', '2026-02-28T24:00:00Z'],
    ['occurred_at', '2026-02-28T12:00:00+00:00'],
  ])('rejects malformed %s (%j)', async (field, value) => {
    const body = JSON.stringify({ ...events.envelope, event: 'ping', data: {}, [field]: value });
    await expect(parseWebhookEvent(body, signedHeaders(body), secret)).rejects.toMatchObject({
      field: `webhook.${field === 'actor' && value ? 'actor.id' : field}`,
    });
  });

  it('rejects missing, ambiguous, or mismatched webhook headers', async () => {
    const body = JSON.stringify({ ...events.envelope, event: 'ping', data: {} });
    const headers = signedHeaders(body);
    await expect(parseWebhookEvent(body, {}, secret)).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
    await expect(
      parseWebhookEvent(body, { ...headers, 'x-mopux-signature': headers['X-MOPUX-SIGNATURE'] }, secret),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
    await expect(
      parseWebhookEvent(body, { ...headers, 'X-mOPUX-eVENT': 'task.created' }, secret),
    ).rejects.toMatchObject({ field: 'X-Mopux-Event' });
    await expect(
      parseWebhookEvent(body, { ...headers, 'X-mOPUX-eVENT': ['ping', 'ping'] }, secret),
    ).rejects.toMatchObject({ field: 'X-Mopux-Event' });
    await expect(parseWebhookEvent(body, { ...headers, 'X-Mopux-Delivery': delivery }, secret)).rejects.toMatchObject({
      field: 'X-Mopux-Delivery',
    });
  });
});

it('validates event-specific fields when their accessors are read', async () => {
  const event = 'task.updated';
  const data = {
    task: { ...taskDetail, priority: 4 },
    changes: { title: { old: 'Before' } },
    assigned_user_ids: [1, false],
    previous_status: true,
    previous_project_id: '10',
  };
  const body = JSON.stringify({ ...events.envelope, event, data });
  const parsed = await parseWebhookEvent(body, signedHeaders(body, event), secret);
  expect(parsed.data).toEqual(data);
  expect(() => parsed.task()).toThrow(InvalidWebhookPayloadError);
  expect(() => parsed.changes()).toThrow(InvalidWebhookPayloadError);
  expect(() => parsed.assignedUserIds()).toThrow(InvalidWebhookPayloadError);
  expect(() => parsed.previousStatus()).toThrow(InvalidWebhookPayloadError);
  expect(parsed.previousProjectId()).toBe(10);
});
