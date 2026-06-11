import { useMemo, useState } from 'react';

/**
 * Generic client-side sorting hook for tabular data.
 *
 * Usage:
 *   const { sorted, sort, setSort } = useSortableTable(rows, {
 *     name:  (u) => u.full_name ?? '',
 *     email: (u) => u.email,
 *     hours: (u) => u.weekly_capacity_hours,
 *   }, { key: 'name', dir: 'asc' });
 *
 *   <SortableHeader sortKey="name" sort={sort} setSort={setSort}>Name</SortableHeader>
 *   {sorted.map(...)}
 *
 * `accessors` maps a column key (any string) to a function returning the
 * comparable value (string | number | Date | null/undefined). Strings are
 * compared case-insensitively; numbers and Dates use natural order; null /
 * undefined sort last regardless of direction so empty cells don't bury the
 * meaningful rows.
 *
 * The sort is stable: when two rows compare equal the original input order
 * is preserved (we tag each row with its original index).
 */
export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  key: K;
  dir: SortDir;
}

export type Accessor<T> = (row: T) => string | number | Date | null | undefined;

export interface UseSortableTableResult<T, K extends string> {
  sorted: T[];
  sort: SortState<K>;
  /** Click handler: same key flips direction, different key resets to asc. */
  setSort: (key: K) => void;
}

/**
 * Apply a stable sort to `rows` using the accessor registered under
 * `sort.key`. If the key is missing from `accessors` the rows are returned
 * unsorted (defensive — keeps the table rendering when columns are toggled).
 *
 * `K` is inferred from `keyof accessors`, so the accessors object literal
 * widens to its full set of keys (otherwise TS would collapse `K` to the
 * single literal type of `initial.key` and reject the other entries).
 */
export function useSortableTable<
  T,
  A extends Record<string, Accessor<T>>,
>(
  rows: T[],
  accessors: A,
  initial: { key: Extract<keyof A, string>; dir: SortDir },
): UseSortableTableResult<T, Extract<keyof A, string>> {
  type K = Extract<keyof A, string>;
  const [sort, setSortState] = useState<SortState<K>>(initial);

  const sorted = useMemo(() => {
    const accessor = accessors[sort.key];
    if (!accessor) return rows;
    const tagged = rows.map((row, idx) => ({ row, idx, val: accessor(row) }));
    tagged.sort((a, b) => {
      const cmp = compareValues(a.val, b.val);
      if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp;
      return a.idx - b.idx; // stable
    });
    return tagged.map((t) => t.row);
  }, [rows, accessors, sort]);

  const setSort = (key: K): void => {
    setSortState((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  };

  return { sorted, sort, setSort };
}

/** null / undefined always sort last; strings are case-insensitive. */
function compareValues(
  a: string | number | Date | null | undefined,
  b: string | number | Date | null | undefined,
): number {
  const aMissing = a === null || a === undefined || a === '';
  const bMissing = b === null || b === undefined || b === '';
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).toLocaleLowerCase().localeCompare(String(b).toLocaleLowerCase());
}


