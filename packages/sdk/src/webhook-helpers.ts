import { InvalidWebhookPayloadError, InvalidWebhookSignatureError } from './errors.js';
import { WebhookEvent } from './webhook-event.js';

export type WebhookBody = string | Uint8Array | ArrayBuffer;
export type WebhookHeaders = Headers | Readonly<Record<string, string | readonly (string | null)[] | undefined>>;

export interface WebhookSignatureOptions {
  /** Maximum clock skew in seconds, in either direction. Defaults to 300. */
  tolerance?: number;
  /** Current Unix timestamp in seconds. Defaults to the current time. */
  now?: number;
}

const encoder = new TextEncoder();

function bytes(rawBody: WebhookBody): Uint8Array {
  if (typeof rawBody === 'string') return encoder.encode(rawBody);
  return ArrayBuffer.isView(rawBody) ? rawBody : new Uint8Array(rawBody);
}

function singleHeader(headers: WebhookHeaders, name: string): string {
  if ('get' in headers && typeof headers.get === 'function') {
    const value = headers.get(name) ?? '';
    // Fetch Headers combines repeated values with commas. Only the signature contains a comma.
    return name !== 'x-mopux-signature' && value.includes(',') ? '' : value;
  }
  const values = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === name)
    .flatMap(([, value]) => value ?? []);
  return values.length === 1 ? (values[0] ?? '') : '';
}

export function webhookHelpers(subtle: () => typeof globalThis.crypto.subtle) {
  /** Resolves when the signature is valid, or throws InvalidWebhookSignatureError. */
  async function verifyWebhookSignature(
    rawBody: WebhookBody,
    header: string | null | undefined,
    secret: string,
    { tolerance = 300, now = Math.floor(Date.now() / 1000) }: WebhookSignatureOptions = {},
  ): Promise<void> {
    const match = /^t=(0|[1-9][0-9]{0,18}),v1=([0-9a-f]{64})$/.exec(header ?? '');
    const timestamp = match?.[1];
    const hex = match?.[2];
    if (timestamp === undefined || hex === undefined || BigInt(timestamp) > 9_223_372_036_854_775_807n) {
      throw new InvalidWebhookSignatureError('Malformed Mopux webhook signature header.');
    }
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(tolerance) || tolerance < 0) {
      throw new InvalidWebhookSignatureError('Mopux webhook timestamp is outside the allowed tolerance.');
    }
    const skew = BigInt(now) - BigInt(timestamp);
    const limit = BigInt(tolerance);
    if (skew < -limit || skew > limit) {
      throw new InvalidWebhookSignatureError('Mopux webhook timestamp is outside the allowed tolerance.');
    }
    if (secret === '') {
      throw new InvalidWebhookSignatureError('Mopux webhook signature does not match.');
    }

    const prefix = encoder.encode(`${timestamp}.`);
    const body = bytes(rawBody);
    const signed = new Uint8Array(prefix.length + body.length);
    signed.set(prefix);
    signed.set(body, prefix.length);
    const digest = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

    const crypto = subtle();
    const key = await crypto.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'verify',
    ]);
    // Web Crypto checks the MAC without comparing attacker-controlled bytes in JavaScript.
    if (!(await crypto.verify('HMAC', key, digest, signed))) {
      throw new InvalidWebhookSignatureError('Mopux webhook signature does not match.');
    }
  }

  /** Verify the exact request bytes before decoding and validating the event envelope. */
  async function parseWebhookEvent(
    rawBody: WebhookBody,
    headers: WebhookHeaders,
    secret: string,
  ): Promise<WebhookEvent> {
    const body = Uint8Array.from(bytes(rawBody));
    const signature = singleHeader(headers, 'x-mopux-signature');
    const event = singleHeader(headers, 'x-mopux-event');
    const delivery = singleHeader(headers, 'x-mopux-delivery');
    await verifyWebhookSignature(body, signature, secret);

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body));
    } catch {
      throw new InvalidWebhookPayloadError('webhook', 'expected valid UTF-8 JSON');
    }
    return WebhookEvent.fromVerifiedPayload(payload, event, delivery);
  }

  return { verifyWebhookSignature, parseWebhookEvent };
}
