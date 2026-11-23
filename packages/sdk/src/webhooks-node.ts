import { webcrypto } from 'node:crypto';
import { webhookHelpers } from './webhook-helpers.js';

export { InvalidWebhookPayloadError, InvalidWebhookSignatureError } from './errors.js';
export { WebhookEvent, type WebhookEventData, WebhookEventType } from './webhook-event.js';
export type { WebhookBody, WebhookHeaders, WebhookSignatureOptions } from './webhook-helpers.js';

export const { verifyWebhookSignature, parseWebhookEvent } = webhookHelpers(() => webcrypto.subtle);
