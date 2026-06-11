/**
 * StatusBadge — labelled status indicator for projects and deliverables.
 *
 * Purely presentational: receives a status, returns a coloured pill. The
 * colour mapping is derived from the Telemetry palette's semantic tokens:
 * jade = healthy / done, cobalt = in motion, amber = waiting, ember = at
 * risk, ink = inert.
 */
import type { ProjectStatus, DeliverableStatus } from '../../types/api';
import { prettyLabel } from '../../utils/labels';

type AnyStatus = ProjectStatus | DeliverableStatus | string;

interface Props {
  status: AnyStatus;
  /** Optional override label; defaults to a title-cased status. */
  label?: string;
  /** `dot` renders a 6px dot + label; `pill` is the default solid pill. */
  variant?: 'pill' | 'dot';
  className?: string;
}

interface Tone {
  bg: string;
  fg: string;
  ring: string;
  dot: string;
}

/* Tone map — every status the back-end emits has an explicit entry. */
const TONES: Record<string, Tone> = {
  // ProjectStatus
  planned:     { bg: 'bg-sky-50',    fg: 'text-sky-700',    ring: 'ring-sky-100',    dot: 'bg-sky-500' },
  active:      { bg: 'bg-brand-50',  fg: 'text-brand-700',  ring: 'ring-brand-100',  dot: 'bg-brand-600' },
  on_hold:     { bg: 'bg-amber-50',  fg: 'text-amber-700',  ring: 'ring-amber-100',  dot: 'bg-amber-500' },
  done:        { bg: 'bg-jade-50',   fg: 'text-jade-700',   ring: 'ring-jade-100',   dot: 'bg-jade-500' },
  cancelled:   { bg: 'bg-ink-200/40',fg: 'text-ink-500',    ring: 'ring-ink-200',    dot: 'bg-ink-300' },
  // DeliverableStatus
  todo:        { bg: 'bg-ink-200/30',fg: 'text-ink-700',    ring: 'ring-ink-200',    dot: 'bg-ink-300' },
  in_progress: { bg: 'bg-brand-50',  fg: 'text-brand-700',  ring: 'ring-brand-100',  dot: 'bg-brand-600' },
  blocked:     { bg: 'bg-ember-50',  fg: 'text-ember-700',  ring: 'ring-ember-100',  dot: 'bg-ember-500' },
};

const FALLBACK: Tone = { bg: 'bg-ink-200/30', fg: 'text-ink-700', ring: 'ring-ink-200', dot: 'bg-ink-300' };

export function StatusBadge({ status, label, variant = 'pill', className = '' }: Props) {
  const tone = TONES[status] ?? FALLBACK;
  const text = label ?? prettyLabel(String(status));

  if (variant === 'dot') {
    return (
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${tone.fg} ${className}`}>
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        {text}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone.bg} ${tone.fg} ${tone.ring} ${className}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {text}
    </span>
  );
}



