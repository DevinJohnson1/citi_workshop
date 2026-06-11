import type { Deliverable, DeliverableStatus, Project } from '../../types/api';

/**
 * HealthStrip — Telemetry's signature element.
 *
 * A 3 px-tall horizontal segmented bar whose each cell is a deliverable
 * coloured by status. Read top-down on a project card or end-to-end on the
 * topbar, the portfolio's health is legible as a colour barcode within the
 * three-second test the brief demands.
 *
 * Purely presentational: accepts deliverables (or a pre-computed segment
 * array for non-deliverable contexts), renders the strip, fires nothing.
 */
type Segment = { tone: StripTone; title?: string };
type StripTone = 'done' | 'in_progress' | 'blocked' | 'overdue' | 'todo' | 'cancelled' | 'unknown';

interface Props {
  /** Either pass `deliverables` (preferred) or `segments` for custom use. */
  deliverables?: Deliverable[];
  segments?: Segment[];
  /** Pass the parent project so an `is_at_risk` border can wrap the strip. */
  project?: Project;
  /** Optional bar height in px. Default 4. The topbar uses 3. */
  height?: number;
  /** Show a tiny right-aligned legend with counts. */
  showCounts?: boolean;
  className?: string;
}

const TONE_CLASS: Record<StripTone, string> = {
  done:        'bg-jade-500',
  in_progress: 'bg-brand-600',
  blocked:     'bg-amber-500',
  overdue:     'bg-ember-500',
  todo:        'bg-ink-200',
  cancelled:   'bg-ink-300/60',
  unknown:     'bg-ink-200/40',
};

function toneFor(d: Deliverable): StripTone {
  if (d.is_outdated) return 'overdue';
  return ((d.status as DeliverableStatus | undefined) ?? 'unknown') as StripTone;
}

export function HealthStrip({
  deliverables,
  segments,
  project,
  height = 4,
  showCounts = false,
  className = '',
}: Props) {
  const cells: Segment[] = segments
    ?? (deliverables ?? []).map((d) => ({
      tone: toneFor(d),
      title: `${d.title} — ${d.is_outdated ? 'overdue' : d.status}`,
    }));

  const empty = cells.length === 0;

  // Aggregate counts for the optional legend.
  const counts = cells.reduce<Record<StripTone, number>>((acc, c) => {
    acc[c.tone] = (acc[c.tone] ?? 0) + 1; return acc;
  }, { done: 0, in_progress: 0, blocked: 0, overdue: 0, todo: 0, cancelled: 0, unknown: 0 });

  const atRisk = project?.is_at_risk ?? counts.overdue > 0;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        role="img"
        aria-label={
          empty
            ? 'No deliverables yet'
            : `Health: ${counts.done} done, ${counts.in_progress} in progress, ${counts.blocked} blocked, ${counts.overdue} overdue, ${counts.todo} to-do`
        }
        className={`flex flex-1 overflow-hidden rounded-full ring-1 ${atRisk ? 'ring-ember-500/40' : 'ring-line'}`}
        style={{ height: `${height}px` }}
      >
        {empty ? (
          <div className="h-full w-full bg-ink-200/40" />
        ) : (
          cells.map((c, i) => (
            <div
              key={i}
              title={c.title}
              className={`${TONE_CLASS[c.tone]} h-full`}
              style={{ width: `${100 / cells.length}%` }}
            />
          ))
        )}
      </div>

      {showCounts && !empty && (
        <div className="flex shrink-0 items-center gap-2 font-mono tnum text-[11px] text-ink-500">
          <Legend tone="done" n={counts.done} />
          <Legend tone="in_progress" n={counts.in_progress} />
          <Legend tone="blocked" n={counts.blocked} />
          <Legend tone="overdue" n={counts.overdue} />
        </div>
      )}
    </div>
  );
}

function Legend({ tone, n }: { tone: StripTone; n: number }) {
  if (n === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TONE_CLASS[tone]}`} />
      {n}
    </span>
  );
}

