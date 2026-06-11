import type { SortState } from '../../utils/useSortableTable';

/**
 * Clickable table header with sort affordance.
 *
 * Renders a `<th><button>` pair so the entire header is a real button (full
 * keyboard support and screen-reader semantics). The active column shows
 * a filled chevron in its direction; inactive columns show a dimmed
 * up-down icon to hint that sorting is available.
 *
 * Use inside a `<thead><tr>` driven by `useSortableTable`:
 *   <SortableHeader sortKey="name" sort={sort} setSort={setSort}>Name</SortableHeader>
 *
 * For non-sortable columns (Actions, embedded controls) render a plain
 * `<th>` instead — this component is opt-in per column.
 */
interface Props<K extends string> {
  /** Column identifier matching a key in the accessors map. */
  sortKey: K;
  sort: SortState<K>;
  setSort: (key: K) => void;
  /** Right-aligned numeric columns benefit from `align="right"`. */
  align?: 'left' | 'right';
  /** Tooltip shown on hover (mirrored to `aria-label` for the button). */
  title?: string;
  children: React.ReactNode;
  /** Extra Tailwind classes appended to the `<th>`. */
  className?: string;
}

export function SortableHeader<K extends string>({
  sortKey,
  sort,
  setSort,
  align = 'left',
  title,
  children,
  className = '',
}: Props<K>) {
  const active = sort.key === sortKey;
  const dir = active ? sort.dir : undefined;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const justify = align === 'right' ? 'justify-end' : 'justify-start';
  const cellAlign = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-4 py-2.5 ${cellAlign} font-semibold ${className}`}
    >
      <button
        type="button"
        onClick={() => setSort(sortKey)}
        title={title}
        aria-label={title ? `${title} — sort` : undefined}
        className={`group inline-flex w-full items-center gap-1 ${justify} hover:text-ink-900`}
      >
        <span>{children}</span>
        <SortIcon dir={dir} />
      </button>
    </th>
  );
}

/** Tri-state chevron: dim up-down when inactive, solid arrow when active. */
function SortIcon({ dir }: { dir?: 'asc' | 'desc' }) {
  if (!dir) {
    return (
      <svg
        viewBox="0 0 12 12"
        className="h-3 w-3 text-ink-300 opacity-60 group-hover:opacity-100"
        aria-hidden
        fill="currentColor"
      >
        <path d="M6 2 3 5h6L6 2Z" />
        <path d="M6 10 3 7h6l-3 3Z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3 w-3 text-brand-600"
      aria-hidden
      fill="currentColor"
    >
      {dir === 'asc' ? <path d="M6 3 2 8h8L6 3Z" /> : <path d="M6 9 2 4h8L6 9Z" />}
    </svg>
  );
}

