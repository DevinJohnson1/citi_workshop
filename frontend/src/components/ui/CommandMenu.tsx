import { useMemo, useRef, useState } from 'react';
import { SearchIcon } from './icons';

export interface ComboboxItem {
  value: string;
  label: string;
  /** Optional secondary text shown muted to the right. */
  hint?: string;
}

interface CommandMenuProps {
  items: ComboboxItem[];
  onSelect: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
}

/**
 * Keyboard-navigable combobox menu (cmdk-style, hand-built).
 *  - Type to filter by label (case-insensitive substring).
 *  - ArrowUp / ArrowDown move the active row (wraps).
 *  - Enter selects the active row; Escape is handled by the parent Popover.
 * Designed to live inside a {@link Popover} panel.
 */
export function CommandMenu({
  items,
  onSelect,
  placeholder = 'Search…',
  emptyText = 'No results.',
}: CommandMenuProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, query]);

  const clampActive = (next: number) => {
    if (filtered.length === 0) return 0;
    return (next + filtered.length) % filtered.length;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => clampActive(a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => clampActive(a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[active];
      if (item) onSelect(item.value);
    }
  };

  return (
    <div className="w-60" role="combobox" aria-expanded aria-haspopup="listbox">
      <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-2">
        <SearchIcon className="text-content-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full bg-transparent text-[13px] text-content placeholder:text-content-muted focus:outline-none"
        />
      </div>
      <ul ref={listRef} role="listbox" className="max-h-56 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <li className="px-2.5 py-2 text-[11px] text-content-muted">{emptyText}</li>
        ) : (
          filtered.map((item, idx) => (
            <li key={item.value} role="option" aria-selected={idx === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(idx)}
                onClick={() => onSelect(item.value)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150 ${
                  idx === active
                    ? 'bg-accent-500/15 text-content'
                    : 'text-content-secondary hover:bg-white/5'
                }`}
              >
                <span className="truncate">{item.label}</span>
                {item.hint && (
                  <span className="shrink-0 text-[11px] text-content-muted">{item.hint}</span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
