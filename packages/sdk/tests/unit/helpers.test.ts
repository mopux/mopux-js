import { describe, expect, it } from 'vitest';
import { buildQuery } from '../../src/http/query.js';
import { InvalidInputError, Page, parseRetryAfter, RetryPolicy } from '../../src/index.js';
import * as v from '../../src/validate.js';

describe('buildQuery', () => {
  it('drops empty values, encodes booleans, lists and nested objects', () => {
    expect(
      decodeURIComponent(buildQuery({ a: null, b: undefined, c: true, d: false, e: [1, 2], f: { g: ['x y'] } })),
    ).toBe('c=1&d=0&e[]=1&e[]=2&f[g][]=x y');
    expect(buildQuery({ q: 'a&b=c' })).toBe('q=a%26b%3Dc');
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(new Date(Date.now() + 10_000).toUTCString())).toBeGreaterThanOrEqual(9);
  });
});

describe('validation helpers', () => {
  it.each([
    ['1:30', '01:30'],
    ['01:30:00', '01:30'],
    [90, '01:30'],
    ['99:59', '99:59'],
  ])('normalizes hours %s', (input, expected) => {
    expect(v.hours(input, 'hours')).toBe(expected);
  });

  it.each(['1:75', '100:00', 'two', -1, 1.5])('rejects hours %s', (input) => {
    expect(() => v.hours(input, 'hours')).toThrow(InvalidInputError);
  });

  it('validates calendar dates and formats Date objects', () => {
    expect(v.date('2028-02-29', 'd')).toBe('2028-02-29');
    expect(v.date(new Date(2026, 10, 5), 'd')).toBe('2026-11-05');
    expect(() => v.date('2026-02-29', 'd')).toThrow(InvalidInputError);
    expect(() => v.date('29/02/2028', 'd')).toThrow(InvalidInputError);
  });

  it('rejects negative retry settings', () => {
    expect(() => new RetryPolicy({ maxRetries: -1 })).toThrow(InvalidInputError);
  });
});

describe('Page', () => {
  it('knows when there are more pages with and without totals', () => {
    expect(new Page([1, 2], 1, 2).hasMore()).toBe(true);
    expect(new Page([1, 2], 2, 2).hasMore()).toBe(false);
    expect(new Page([1, 2], 1, null, 2).nextPage()).toBe(2);
    expect(new Page([1], 1, null, 2).hasMore()).toBe(false);
    expect(new Page([], 1, 5).hasMore()).toBe(false);
    expect([...new Page(['a', 'b'])]).toEqual(['a', 'b']);
  });

  it('stops iterating if the API repeats the same page', async () => {
    let calls = 0;
    const items: number[] = [];
    for await (const item of Page.iterate(async () => {
      calls++;
      return new Page([calls], 1, 9);
    })) {
      items.push(item);
    }
    expect(items).toEqual([1, 2]);
  });
});
