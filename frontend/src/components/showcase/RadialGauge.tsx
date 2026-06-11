/**
 * RadialGauge — a 270°-arc progress dial rendered as inline SVG.
 *
 * Used by `CompletionScene` to show the deliverable completion percentage as
 * a cinematic ring. Purely presentational: fires nothing, accepts a 0-100
 * value and a colour tone, draws an arc.
 *
 * The arc geometry is calculated from a fixed `r` and a stroke-dasharray /
 * stroke-dashoffset pair, so animating to a new value happens by CSS
 * transition on the dashoffset — no JS frame loop. The transition is
 * disabled at the source by the global `prefers-reduced-motion` rule.
 */
interface Props {
  /** 0 – 100. Values outside the range are clamped. */
  value: number;
  /** Diameter in px. Default 240. */
  size?: number;
  /** Foreground arc tone — defaults to cobalt. */
  tone?: 'brand' | 'jade' | 'amber' | 'ember';
  /** Children render in the centre (typically the big percentage). */
  children?: React.ReactNode;
}

const TONE = {
  brand: '#3957d6',
  jade:  '#13a085',
  amber: '#e89b2c',
  ember: '#e35454',
} as const;

export function RadialGauge({ value, size = 240, tone = 'brand', children }: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  const strokeWidth = Math.max(8, Math.round(size * 0.06));
  const radius = (size - strokeWidth) / 2;
  // Use 270° of arc, leaving the bottom 90° for visual weight. The
  // dasharray covers the visible arc; dashoffset draws the *progress* slice
  // inside that arc.
  const arcLength = 2 * Math.PI * radius;
  const visibleArc = arcLength * 0.75;
  const dashOffset = visibleArc * (1 - clamped / 100);
  const fg = TONE[tone];

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
        aria-hidden
      >
        <defs>
          <linearGradient id={`gauge-grad-${tone}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor={fg} stopOpacity="0.9" />
            <stop offset="100%" stopColor={fg} stopOpacity="0.55" />
          </linearGradient>
          <filter id={`gauge-glow-${tone}`}>
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Rotate by 135° so the open gap sits at the bottom. */}
        <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={strokeWidth}
            strokeDasharray={`${visibleArc} ${arcLength}`}
            strokeLinecap="round"
          />
          {/* Progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`url(#gauge-grad-${tone})`}
            strokeWidth={strokeWidth}
            strokeDasharray={`${visibleArc} ${arcLength}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            filter={`url(#gauge-glow-${tone})`}
            style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.2, 0.6, 0.2, 1)' }}
          />
        </g>
      </svg>
      <div className="relative grid place-items-center text-center">{children}</div>
    </div>
  );
}

