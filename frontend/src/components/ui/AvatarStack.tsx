import type { User } from '../../types/api';

/**
 * AvatarStack — overlapping avatar circles with overflow count.
 *
 * Initials are derived from `full_name` (or email local-part fallback);
 * the background colour is hashed from the user id so a given person
 * keeps the same hue everywhere in the app. Purely presentational —
 * `onAssign` is forwarded to the trailing "+" button and any wrapping
 * tooltip; this component fires no API calls itself.
 */
interface Props {
  users: User[];
  max?: number;
  /** Optional callback wired to the "+" affordance after the stack. */
  onAssign?: () => void;
  size?: 'sm' | 'md';
  className?: string;
}

/* 8 calibrated palettes — all WCAG-AA against white initials. */
const HUES = [
  'bg-brand-600', 'bg-jade-500', 'bg-violet-500', 'bg-sky-500',
  'bg-amber-500', 'bg-ember-500', 'bg-ink-700',   'bg-brand-500',
] as const;

/**
 * Deterministic hue picker — same id always maps to the same Tailwind
 * background class so a user keeps the same colour across every screen.
 * Exported for the single-bubble {@link Avatar} component.
 */
export function hueFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length]!;
}

/**
 * Two-letter initials for a user. Prefers `full_name` ("Olivia Bennett" →
 * "OB"); falls back to the first two letters of the email local-part when
 * no name is set, and finally to "?".
 */
export function initialsFor(source: string | undefined | null): string {
  const trimmed = (source ?? '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? '') + (parts[parts.length - 1]![0] ?? '')).toUpperCase();
}

function initials(u: User): string {
  return initialsFor(u.full_name?.trim() || u.email?.split('@')[0]);
}

const AVATAR_SIZES = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-7 w-7 text-[11px]',
  lg: 'h-9 w-9 text-xs',
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZES;

interface AvatarProps {
  /** Display name; first + last initials are derived from this. */
  name?: string | null;
  /** Email fallback used both for initials and for the tooltip. */
  email?: string | null;
  /** Stable id used to pick a deterministic hue; defaults to `email`. */
  hueKey?: string;
  size?: AvatarSize;
  className?: string;
}

/**
 * Single round avatar bubble showing a user's first+last initials over a
 * deterministic hue. Used wherever a user is named in the UI (People
 * list, Admin table, Topbar, …) to give every account a recognisable
 * visual marker even when no photo is configured.
 */
export function Avatar({ name, email, hueKey, size = 'md', className = '' }: AvatarProps) {
  const label = (name?.trim() || email || '').trim();
  const text = initialsFor(name?.trim() || email?.split('@')[0]);
  const hue = hueFor(hueKey || email || label || text);
  return (
    <span
      title={label || undefined}
      aria-label={label ? `${label} avatar` : 'User avatar'}
      className={`${AVATAR_SIZES[size]} ${hue} inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
    >
      {text}
    </span>
  );
}

export function AvatarStack({ users, max = 4, onAssign, size = 'md', className = '' }: Props) {
  const visible = users.slice(0, max);
  const overflow = Math.max(0, users.length - visible.length);
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-[11px]';

  return (
    <div className={`flex items-center ${className}`}>
      <div className="flex -space-x-1.5">
        {visible.map((u) => (
          <span
            key={u.id}
            title={u.full_name || u.email}
            className={`${dim} ${hueFor(u.id)} inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface`}
          >
            {initials(u)}
          </span>
        ))}
        {overflow > 0 && (
          <span
            className={`${dim} inline-flex items-center justify-center rounded-full bg-ink-200 font-semibold text-ink-700 ring-2 ring-surface tnum`}
            aria-label={`${overflow} more`}
          >
            +{overflow}
          </span>
        )}
      </div>
      {onAssign && (
        <button
          type="button"
          onClick={onAssign}
          className={`${dim} ml-1 inline-flex items-center justify-center rounded-full border border-dashed border-line-strong text-ink-400 hover:border-brand-600 hover:text-brand-600`}
          aria-label="Assign someone"
        >
          +
        </button>
      )}
    </div>
  );
}

