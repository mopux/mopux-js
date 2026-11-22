import { isRecord } from './errors.js';

/**
 * One page of a listing. The API uses three shapes and Page accepts all of them:
 * Laravel `{data, links, meta}`, page fields inside the object (`{members, page, last_page, total}`)
 * and plain lists (comments and notifications up to API 1.1, without totals).
 */
export class Page<T> {
  constructor(
    readonly items: T[],
    readonly currentPage = 1,
    readonly lastPage: number | null = null,
    readonly perPage: number | null = null,
    readonly total: number | null = null,
  ) {}

  /** Laravel paginator or a plain list (APIs that moved to Laravel pagination in 1.2). */
  static from<T>(data: unknown, page = 1, perPage: number | null = null): Page<T> {
    if (Array.isArray(data)) {
      return new Page<T>(data as T[], page, null, perPage, null);
    }
    if (isRecord(data) && Array.isArray(data.data)) {
      const meta = isRecord(data.meta) ? data.meta : {};
      return new Page<T>(
        data.data as T[],
        int(meta.current_page) ?? page,
        int(meta.last_page),
        int(meta.per_page) ?? perPage,
        int(meta.total),
      );
    }
    return new Page<T>([], page, null, perPage, null);
  }

  /** Page fields in the object itself, with the items under `itemsKey`. */
  static fromPageFields<T>(data: unknown, itemsKey: string, perPage: number | null = null): Page<T> {
    const record = isRecord(data) ? data : {};
    const items = Array.isArray(record[itemsKey]) ? (record[itemsKey] as T[]) : [];
    return new Page<T>(items, int(record.page) ?? 1, int(record.last_page), perPage, int(record.total));
  }

  /**
   * Walks every page lazily from `firstPage`, yielding items one by one. A page is requested
   * only when the loop reaches it.
   */
  static async *iterate<T>(fetchPage: (page: number) => Promise<Page<T>>, firstPage = 1): AsyncGenerator<T> {
    let page: number | null = firstPage;
    while (page !== null) {
      const result: Page<T> = await fetchPage(page);
      yield* result.items;
      const next = result.nextPage();
      page = next !== null && next > page ? next : null;
    }
  }

  hasMore(): boolean {
    if (this.items.length === 0) {
      return false;
    }
    if (this.lastPage !== null) {
      return this.currentPage < this.lastPage;
    }
    return this.perPage !== null && this.items.length >= this.perPage;
  }

  nextPage(): number | null {
    return this.hasMore() ? this.currentPage + 1 : null;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]();
  }
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
