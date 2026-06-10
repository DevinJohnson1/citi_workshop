import type { DeliverableStatus } from '../../types/api';
import { Popover } from './Popover';

/** Visual metadata for each deliverable status (soft tints, not solids). */
const STATUS_META: Record<
  DeliverableStatus,
  { label: string; dot: string; pill: string }
> = {
  todo: {
    label: 'Todo',
    dot: 'bg-status-todo',
    pill: 'bg-status-todo/10 text-content-secondary border-status-todo/20',
  },
  in_progress: {
    label: 'In progress',
    dot: 'bg-status-progress',
    pill: 'bg-status-progress/10 text-status-progress border-status-progress/25',
  },
  blocked: {
    label: 'Blocked',
    dot: 'bg-status-blocked',
    pill: 'bg-status-blocked/10 text-status-blocked border-status-blocked/25',
  },
  done: {
    label: 'Done',
    dot: 'bg-status-done',
    pill: 'bg-status-done/10 text-status-done border-status-done/25',
  },
  cancelled: {
    label: 'Cancelled',
    dot: 'bg-status-todo',
    pill: 'bg-status-todo/10 text-content-muted border-status-todo/20',
  },
};

export const STATUS_ORDER: DeliverableStatus[] = [
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
];

/** Read-only status pill — used wherever the user can't change status. */
export function StatusPill({ status }: { status: DeliverableStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 ${meta.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
      {meta.label}
    </span>
  );
}

/**
 * Interactive status pill. Click opens a compact popover listing the status
 * options as colored dots; selecting one fires `onChange` and closes. The
 * original status-change callback still drives the request upstream.
 */
export function StatusSelectPill({
  status,
  options = STATUS_ORDER,
  onChange,
}: {
  status: DeliverableStatus;
  options?: DeliverableStatus[];
  onChange: (next: DeliverableStatus) => void;
}) {
  const meta = STATUS_META[status];
  return (
    <Popover
      role="menu"
      align="start"
      trigger={
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 hover:brightness-110 ${meta.pill}`}
          aria-label={`Status: ${meta.label}. Change status`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
          {meta.label}
        </button>
      }
    >
      {(close) => (
        <ul className="w-40">
          {options.map((s) => {
            const m = STATUS_META[s];
            const selected = s === status;
            return (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => {
                    if (s !== status) onChange(s);
                    close();
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors duration-150 ${
                    selected ? 'bg-white/5 text-content' : 'text-content-secondary hover:bg-white/5'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${m.dot}`} aria-hidden />
                  {m.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Popover>
  );
}
