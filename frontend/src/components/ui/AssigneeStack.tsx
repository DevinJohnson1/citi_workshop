import type { Assignment, User } from '../../types/api';
import { overworkSuffix } from '../OverworkBadge';
import { Popover } from './Popover';
import { CommandMenu, type ComboboxItem } from './CommandMenu';
import { Tooltip } from './Tooltip';
import { PlusIcon, XIcon } from './icons';

/** Deterministic avatar tint from a string id, drawn from the accent family. */
const AVATAR_TINTS = [
  'bg-accent-500/20 text-accent-400',
  'bg-status-progress/20 text-status-progress',
  'bg-status-done/20 text-status-done',
  'bg-sky-500/20 text-sky-400',
  'bg-rose-500/20 text-rose-400',
];

function tintFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function Avatar({ label, id, size = 24 }: { label: string; id: string; size?: number }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full text-[10px] font-semibold ring-1 ring-surface-raised ${tintFor(id)}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initials(label)}
    </span>
  );
}

interface AssigneeStackProps {
  assignments: Assignment[];
  /** Resolve an assignment's user id to a display name. */
  nameFor: (userId: string) => string;
  /** Users that can be newly assigned (already-assigned ones filtered out). */
  assignablePool?: User[];
  onAssign?: (userId: string) => void;
  onRemove?: (assignmentId: string) => void;
  /** When true, the assign/remove affordances render (leads/admin). */
  canManage?: boolean;
}

/**
 * Avatar stack + keyboard combobox quick-assign. Shows up to 3 avatars with a
 * `+N` overflow chip. When `canManage` is set, a `+` opens a searchable
 * combobox to assign a member; hovering an avatar reveals a remove button.
 */
export function AssigneeStack({
  assignments,
  nameFor,
  assignablePool = [],
  onAssign,
  onRemove,
  canManage = false,
}: AssigneeStackProps) {
  const shown = assignments.slice(0, 3);
  const overflow = assignments.length - shown.length;

  const items: ComboboxItem[] = assignablePool.map((u) => ({
    value: u.id,
    label: u.full_name || u.email,
    hint: `${u.role}${overworkSuffix(u)}`.trim(),
  }));

  return (
    <div className="flex items-center gap-2">
      {assignments.length === 0 ? (
        <span className="text-[11px] text-content-muted">Unassigned</span>
      ) : (
        <div className="flex items-center -space-x-1.5">
          {shown.map((a) => {
            const label = nameFor(a.user_id);
            const avatar = (
              <span className="group/avatar relative inline-flex">
                <Avatar id={a.user_id} label={label} />
                {canManage && onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(a.id)}
                    aria-label={`Remove ${label}`}
                    className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-status-blocked text-white ring-1 ring-surface-raised group-hover/avatar:flex"
                  >
                    <XIcon size={9} />
                  </button>
                )}
              </span>
            );
            return (
              <Tooltip key={a.id} label={`${label} · ${a.role_on_assignment}`}>
                {avatar}
              </Tooltip>
            );
          })}
          {overflow > 0 && (
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-[10px] font-semibold text-content-secondary ring-1 ring-surface-raised"
              aria-label={`${overflow} more assignees`}
            >
              +{overflow}
            </span>
          )}
        </div>
      )}

      {canManage && onAssign && items.length > 0 && (
        <Popover
          role="listbox"
          align="start"
          trigger={
            <button
              type="button"
              aria-label="Assign a member"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border-strong text-content-muted transition-colors duration-150 hover:border-accent-500 hover:text-accent-400"
            >
              <PlusIcon size={13} />
            </button>
          }
        >
          {(close) => (
            <CommandMenu
              items={items}
              placeholder="Assign member…"
              emptyText="No members available."
              onSelect={(value) => {
                onAssign(value);
                close();
              }}
            />
          )}
        </Popover>
      )}
    </div>
  );
}
