import type { QueryParams, Touch } from '../types.js';
import * as v from '../validate.js';
import { Resource } from './resource.js';

export interface TouchListOptions {
  box?: QueryParams<'touchesList'>['box'];
  status?: QueryParams<'touchesList'>['status'];
}

export class Touches extends Resource {
  /** Touches received (default) or sent by the user. */
  async list(options: TouchListOptions = {}): Promise<Touch[]> {
    const response = await this.connector.get('touches', { box: options.box ?? 'received', status: options.status });
    return (response.data ?? []) as Touch[];
  }

  /** Answers a received touch. */
  async reply(touchId: number, message: string): Promise<Touch> {
    const response = await this.connector.post(`touches/${v.id(touchId, 'touchId')}/reply`, {
      message: v.text(message, 'message'),
    });
    return response.data as Touch;
  }
}
