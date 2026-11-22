export type QueryValue = string | number | boolean | null | undefined | QueryValue[] | { [key: string]: QueryValue };

/**
 * Builds a query string the way Laravel reads it: null/undefined are dropped, booleans become
 * 1/0, lists are sent as `key[]=a&key[]=b` and objects as `key[sub]=v`.
 */
export function buildQuery(query: Record<string, QueryValue>): string {
  const parts: string[] = [];
  const append = (key: string, value: QueryValue): void => {
    if (value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        append(`${key}[]`, item);
      }
      return;
    }
    if (typeof value === 'object') {
      for (const [sub, item] of Object.entries(value)) {
        append(`${key}[${sub}]`, item);
      }
      return;
    }
    const scalar = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(scalar)}`);
  };

  for (const [key, value] of Object.entries(query)) {
    append(key, value);
  }

  return parts.join('&');
}
