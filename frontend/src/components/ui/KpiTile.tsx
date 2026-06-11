import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * KpiTile — large headline number with a label and an optional trend/legend
 * line beneath it. Used on the Dashboard above the fold.
 *
 * Purely presentational. If `to` is provided the tile becomes a router Link;
 * otherwise it renders as a static div (mirrors the original Dashboard logic
 * around viewer-role gating).
 */
interface Props {
  label: string;
  value: ReactNode;
  /** Sub-line — e.g. trend, period, count. */
  hint?: ReactNode;
  /** Semantic tone influences the left accent bar only. */
  tone?: 'brand' | 'jade' | 'amber' | 'ember' | 'ink';
  to?: string | null;
  /** Optional element rendered at the bottom (HealthStrip, BudgetBar …). */
  footer?: ReactNode;
}

const ACCENT: Record<NonNullable<Props['tone']>, string> = {
  brand: 'before:bg-brand-600',
  jade:  'before:bg-jade-500',
  amber: 'before:bg-amber-500',
  ember: 'before:bg-ember-500',
  ink:   'before:bg-ink-700',
};

export function KpiTile({ label, value, hint, tone = 'brand', to, footer }: Props) {
  const accent = ACCENT[tone];

  const inner = (
    <>
      <div className="label-caps">{label}</div>
      <div className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink-900 tnum">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
      {footer && <div className="mt-3">{footer}</div>}
    </>
  );

  const base = `relative block rounded-lg bg-surface p-4 shadow-card before:absolute before:left-0 before:top-3 before:bottom-3 before:w-0.5 before:rounded-r ${accent} pl-5`;

  if (to) {
    return (
      <Link to={to} className={`${base} transition-shadow hover:shadow-pop`}>
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}

