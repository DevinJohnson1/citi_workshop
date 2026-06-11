/**
 * PriorityIcon — a square chip that signals priority via shape and colour.
 * `Priority` is not defined in the backend types yet; we accept the four
 * generic levels every PM tool uses.  Purely presentational.
 */
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

interface Props {
  priority: Priority;
  showLabel?: boolean;
  className?: string;
}

const STYLE: Record<Priority, { bg: string; fg: string; bars: number; label: string }> = {
  low:     { bg: 'bg-ink-200/40', fg: 'text-ink-500',   bars: 1, label: 'Low' },
  medium:  { bg: 'bg-sky-50',     fg: 'text-sky-700',   bars: 2, label: 'Medium' },
  high:    { bg: 'bg-amber-50',   fg: 'text-amber-700', bars: 3, label: 'High' },
  urgent:  { bg: 'bg-ember-50',   fg: 'text-ember-700', bars: 4, label: 'Urgent' },
};

/**
 * Renders 1–4 vertical bars (ascending) inside a coloured chip. The bar
 * count is a redundant non-colour signal for users who can't rely on hue.
 */
export function PriorityIcon({ priority, showLabel = false, className = '' }: Props) {
  const s = STYLE[priority];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium ${s.bg} ${s.fg} ${className}`}
      title={`Priority: ${s.label}`}
      aria-label={`Priority ${s.label}`}
    >
      <span aria-hidden className="flex items-end gap-[2px] h-3">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`w-[3px] rounded-[1px] ${i <= s.bars ? 'bg-current opacity-90' : 'bg-current opacity-20'}`}
            style={{ height: `${4 + i * 2}px` }}
          />
        ))}
      </span>
      {showLabel && <span>{s.label}</span>}
    </span>
  );
}

