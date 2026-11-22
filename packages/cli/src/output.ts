const STATUS: Record<string, string> = {
  '-1': 'Delayed',
  '0': 'Pending',
  '1': 'In progress',
  '2': 'Review',
  '3': 'Done',
};
const PRIORITY: Record<string, string> = { '0': 'Low', '1': 'Normal', '2': 'High', '9': 'Maximum' };
const PROJECT_STATUS: Record<string, string> = { '-1': 'Delayed', '0': 'Active', '1': 'Finished', '2': 'Archived' };

export const statusName = (value: unknown): string => STATUS[String(value)] ?? String(value ?? '');
export const priorityName = (value: unknown): string => PRIORITY[String(value)] ?? String(value ?? '');
export const projectStatusName = (value: unknown): string => PROJECT_STATUS[String(value)] ?? String(value ?? '');

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** A plain aligned table; empty cells render as an empty string. */
export function table(headers: string[], rows: unknown[][]): string {
  const cells = rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...cells.map((row) => (row[index] ?? '').length)),
  );
  const line = (row: string[]): string =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...cells.map(line)].join('\n');
}

/** `key: value` lines, skipping empty values. */
export function details(entries: [string, unknown][]): string {
  const visible = entries.filter(([, value]) => value !== null && value !== undefined && value !== '');
  const width = Math.max(...visible.map(([key]) => key.length));
  return visible.map(([key, value]) => `${`${key}:`.padEnd(width + 2)}${String(value)}`).join('\n');
}
