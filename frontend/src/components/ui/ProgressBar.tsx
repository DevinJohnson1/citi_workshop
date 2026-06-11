/**
 * ProgressBar — generic 0–100 progress bar.
 *
 * Identical visual language to {@link BudgetBar} so the two compose well
 * when sat next to each other, but tone-agnostic by default. Pass
 * `tone="auto"` to make completion (≥ 100 %) jade-toned.
 */
interface Props {
  value: number;
  /** 'auto' goes jade when value ≥ 100. 'brand' (default) stays cobalt. */
  tone?: 'brand' | 'auto' | 'jade' | 'amber' | 'ember' | 'ink';
  /** Render the % suffix next to the bar. */
  showValue?: boolean;
  className?: string;
}

const TONE_BG: Record<string, string> = {
  brand: 'bg-brand-600',
  jade:  'bg-jade-500',
  amber: 'bg-amber-500',
  ember: 'bg-ember-500',
  ink:   'bg-ink-700',
};

export function ProgressBar({ value, tone = 'brand', showValue = false, className = '' }: Props) {
  const safe = Number.isFinite(value) ? value : 0;
  const pct = Math.max(0, Math.min(100, safe));
  const effective = tone === 'auto' ? (safe >= 100 ? 'jade' : 'brand') : tone;
  const bar = TONE_BG[effective] ?? TONE_BG.brand!;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-ink-200/40"
      >
        <div className={`absolute inset-y-0 left-0 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {showValue && (
        <span className="shrink-0 font-mono tnum text-[11px] text-ink-500">{Math.round(pct)}%</span>
      )}
    </div>
  );
}

