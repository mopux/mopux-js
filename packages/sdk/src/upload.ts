import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import { InvalidInputError } from './errors.js';

/** A file to upload (task documents, comment attachments). */
export class Upload {
  private constructor(
    readonly blob: Blob,
    readonly filename: string,
  ) {}

  /** Reads a file from disk lazily (it is streamed when the request is sent). */
  static async fromPath(path: string, filename = basename(path), contentType?: string): Promise<Upload> {
    const blob = await openAsBlob(path, contentType === undefined ? {} : { type: contentType });
    return new Upload(blob, Upload.name_(filename));
  }

  /** In-memory content (string, bytes or Blob). */
  static from(content: string | Uint8Array | ArrayBuffer | Blob, filename: string, contentType?: string): Upload {
    const blob =
      content instanceof Blob
        ? content
        : new Blob([content as ArrayBuffer], contentType === undefined ? {} : { type: contentType });
    return new Upload(blob, Upload.name_(filename));
  }

  private static name_(filename: string): string {
    if (filename.trim() === '') {
      throw new InvalidInputError('filename', 'cannot be empty.');
    }
    return filename;
  }
}
