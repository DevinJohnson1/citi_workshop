import type { Deliverable } from '../../types/api';
import { Tooltip } from './Tooltip';

export type Priority = 'high' | 'medium' | 'low';

/**
 * Derive a priority from existing deliverable data — the schema has no
 * priority column (see decision log). Heuristic:
 *   - high   : server flagged `is_outdated`, or due within 2 days
 *   - medium : due within the next week
 *   - low    : everything else
 * Done/cancelled work is always low priority.
 */
export function derivePriority(d: Deliverable): Priority {
  if (d.status === 'done' || d.status === 'cancelled') return 'low';
  if (d.is_outdated) return 'high';
  if (!d.due_date) return 'low';
  const target = new Date(d.due_date + 'T00:00:00');
  if (Number.isNaN(target.getTime())) return 'low';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days <= 2) return 'high';
  if (days <= 7) return 'medium';
  return 'low';
}

const META: Record<Priority, { label: string; color: string; bars: number }> = {
  high: { label: 'High priority', color: 'text-status-blocked', bars: 3 },
  medium: { label: 'Medium priority', color: 'text-status-progress', bars: 2 },
  low: { label: 'Low priority', color: 'text-content-muted', bars: 1 },
};

/**
 * Icon-only priority indicator (three ascending bars) with a tooltip — no
 * text label, per the density spec. Shares one implementation across all
 * views.
 */
export function PriorityIcon({ priority }: { priority: Priority }) {
  const meta = META[priority];
  return (
    <Tooltip label={meta.label}>
      <span
        className={`inline-flex items-end gap-[2px] ${meta.color}`}
        aria-label={meta.label}
        role="img"
      >
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className="w-[3px] rounded-[1px] bg-current transition-opacity duration-150"
            style={{
              height: `${4 + bar * 3}px`,
              opacity: bar <= meta.bars ? 1 : 0.25,
            }}
          />
        ))}
      </span>
    </Tooltip>
  );
}
