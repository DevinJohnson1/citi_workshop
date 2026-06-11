import { useMemo, useState } from 'react';
import type { User } from '../../types/api';
import { AvatarStack } from './AvatarStack';
import { roleLabel } from '../../utils/labels';

/**
 * QuickAssign — searchable combobox for assignee management.
 *
 * Purely presentational: filtering + open/close are local UI state; the
 * actual mutations are delegated to the parent via `onAssign` / `onRemove`,
 * which keeps every API call in the existing business-logic code paths.
 */
interface Props {
  assignees: User[];
  allUsers: User[];
  onAssign: (userId: string) => void;
  onRemove: (userId: string) => void;
  /** Optional label rendered above the picker. */
  label?: string;
  disabled?: boolean;
}

export function QuickAssign({ assignees, allUsers, onAssign, onRemove, label, disabled }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const assignedIds = useMemo(() => new Set(assignees.map((u) => u.id)), [assignees]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allUsers
      .filter((u) => !assignedIds.has(u.id))
      .filter((u) => {
        if (!q) return true;
        return (
          u.full_name?.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [allUsers, assignedIds, query]);

  return (
    <div className="space-y-2">
      {label && <div className="label-caps">{label}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <AvatarStack
          users={assignees}
          max={6}
          onAssign={disabled ? undefined : () => setOpen((v) => !v)}
        />
        {assignees.map((u) => (
          <button
            key={u.id}
            type="button"
            disabled={disabled}
            onClick={() => onRemove(u.id)}
            className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs text-ink-700 ring-1 ring-line hover:ring-ember-500 hover:text-ember-700 disabled:opacity-50"
            title={`Remove ${u.full_name || u.email}`}
          >
            <span>{u.full_name || u.email}</span>
            <span aria-hidden>×</span>
          </button>
        ))}
      </div>

      {open && !disabled && (
        <div className="rounded-md border border-line bg-surface p-2 shadow-pop">
          <input
            type="search"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teammates…"
            className="w-full rounded border border-line bg-surface-2 px-2 py-1.5 text-sm placeholder:text-ink-300"
          />
          <ul className="mt-2 max-h-56 overflow-auto">
            {candidates.length === 0 && (
              <li className="px-2 py-3 text-xs text-ink-400">No matches.</li>
            )}
            {candidates.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => { onAssign(u.id); setQuery(''); }}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-brand-50"
                >
                  <span className="truncate">
                    <span className="font-medium text-ink-900">{u.full_name || u.email}</span>
                    {u.job_title && <span className="ml-2 text-xs text-ink-400">{u.job_title}</span>}
                  </span>
                  <span className="ml-2 text-xs text-ink-300">{roleLabel(u.role)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}



