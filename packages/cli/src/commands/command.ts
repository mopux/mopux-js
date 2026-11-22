import type { ParseArgsConfig } from 'node:util';
import type { Context } from '../context.js';
import { UsageError } from '../errors.js';

export type Options = NonNullable<ParseArgsConfig['options']>;
export type Values = Record<string, string | boolean | string[] | boolean[] | undefined>;

export interface Command {
  /** Words that select the command, e.g. `['task', 'create']`. */
  path: string[];
  summary: string;
  usage: string;
  options?: Options;
  run(context: Context, values: Values, args: string[]): Promise<void>;
}

export function str(values: Values, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

export function strings(values: Values, name: string): string[] {
  const value = values[name];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function flag(values: Values, name: string): boolean {
  return values[name] === true;
}

export function positiveInt(value: string | undefined, name: string): number {
  if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1) {
    throw new UsageError(`${name} must be a positive integer${value === undefined ? '' : `, "${value}" given`}.`);
  }
  return Number(value);
}

export function arg(args: string[], index: number, name: string): string {
  const value = args[index];
  if (value === undefined || value === '') {
    throw new UsageError(`Missing ${name}.`);
  }
  return value;
}
