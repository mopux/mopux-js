import { InvalidInputError } from './errors.js';

export function id(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidInputError(field, `expected a positive integer id, ${String(value)} given.`);
  }
  return value;
}

export function ids(values: readonly number[], field: string): number[] {
  return values.map((value) => id(value, field));
}

export function text(value: string, field: string, maxLength?: number): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new InvalidInputError(field, 'cannot be empty.');
  }
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new InvalidInputError(field, `may not be longer than ${maxLength} characters.`);
  }
  return trimmed;
}

export function title(value: string, field = 'title'): string {
  return text(value, field, 255);
}

/** Accepts `YYYY-MM-DD` or a Date (its local calendar day). */
export function date(value: string | Date, field: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new InvalidInputError(field, 'invalid date.');
    }
    const pad = (part: number): string => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) {
    throw new InvalidInputError(field, `expected YYYY-MM-DD, "${value}" given.`);
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new InvalidInputError(field, `"${value}" is not a valid date.`);
  }
  return value.trim();
}

/** Hours as `HH:MM` (also `H:MM` or `HH:MM:SS`) or as a number of minutes; at most 99:59. */
export function hours(value: string | number, field: string): string {
  let h: number;
  let m: number;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new InvalidInputError(field, 'minutes must be a non-negative integer.');
    }
    h = Math.floor(value / 60);
    m = value % 60;
  } else {
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
    if (match === null) {
      throw new InvalidInputError(field, `expected HH:MM, "${value}" given.`);
    }
    h = Number(match[1]);
    m = Number(match[2]);
  }
  if (m > 59 || h > 99) {
    throw new InvalidInputError(field, 'expected at most 99:59.');
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function perPage(value: number, max = 100): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new InvalidInputError('perPage', `must be between 1 and ${max}.`);
  }
  return value;
}

export function page(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidInputError('page', 'must be 1 or greater.');
  }
  return value;
}
