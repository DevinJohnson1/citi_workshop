/**
 * BudgetBar — single-bar budget progress with an over-spend tail.
 *
 * Visual states:
 *   - consumed / planned ≤ 70 %  → jade (healthy)
 *   - 70 – 95 %                   → amber (watch)
 *   - 95 – 100 %                   → ember (about to breach)
 *   - > 100 %                      → ember bar at 100 % with a striped
 *                                    over-spend tail sitting outside
 *
 * Purely presentational. Numbers in / numbers out — no API calls.
 */
interface Props {
  planned: number;
  consumed: number;
  /** ISO currency code, e.g. 'USD'. Optional; affects the side-by-side legend only. */
  currency?: string;
  /** Compact mode hides the side legend for inline use in table cells. */
  compact?: boolean;
  className?: string;
}

function format(n: number, currency?: string): string {
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(n);
    } catch { /* fall through */ }
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

export function BudgetBar({ planned, consumed, currency, compact = false, className = '' }: Props) {
  const safePlanned = Number.isFinite(planned) && planned > 0 ? planned : 0;
  const ratio = safePlanned > 0 ? consumed / safePlanned : 0;
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  const over = ratio > 1 ? Math.min((ratio - 1) * 100, 60) : 0; // cap visual overshoot

  const tone =
    ratio > 1     ? { bar: 'bg-ember-500', text: 'text-ember-700' } :
    ratio > 0.95  ? { bar: 'bg-ember-500', text: 'text-ember-700' } :
    ratio > 0.7   ? { bar: 'bg-amber-500', text: 'text-amber-700' } :
                    { bar: 'bg-jade-500',  text: 'text-jade-700' };

  return (
    <div className={`flex w-full items-center gap-3 ${className}`}>
      <div className="relative h-2 flex-1 overflow-visible rounded-full bg-ink-200/40" role="img"
           aria-label={`Budget ${format(consumed, currency)} of ${format(safePlanned, currency)}`}>
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`}
          style={{ width: `${pct}%` }}
        />
        {over > 0 && (
          <div
            className="absolute inset-y-0 left-full rounded-r-full"
            style={{
              width: `${over}%`,
              backgroundImage:
                'repeating-linear-gradient(45deg, var(--color-ember-500) 0 4px, var(--color-ember-700) 4px 8px)',
            }}
            aria-hidden
          />
        )}
        {/* 100 % tick */}
        <span aria-hidden className="absolute top-1/2 right-0 h-3 w-px -translate-y-1/2 bg-ink-300/60" />
      </div>
      {!compact && (
        <div className={`shrink-0 text-xs font-mono tnum ${tone.text}`}>
          {format(consumed, currency)} / {format(safePlanned, currency)}
          {ratio > 1 && (
            <span className="ml-1 rounded bg-ember-50 px-1 text-[10px] font-semibold text-ember-700">
              +{Math.round((ratio - 1) * 100)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}

