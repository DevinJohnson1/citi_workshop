import type { ReactNode } from 'react';

/**
 * Card — the universal seated surface used throughout the redesign.
 *
 * Visually: white surface, 8 px radius, hairline border, soft shadow.
 * Composable via `title`, `actions`, `footer`. Purely presentational.
 */
interface Props {
  title?: ReactNode;
  /** Small caption above the title — used for "Project" / "Resource" labels. */
  eyebrow?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  /** Optional element rendered flush to the top edge (e.g. HealthStrip). */
  topStrip?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Internal padding override. Default `p-4`. */
  bodyClassName?: string;
}

export function Card({
  title, eyebrow, actions, footer, topStrip, children, className = '', bodyClassName = 'p-4',
}: Props) {
  return (
    <section className={`overflow-hidden rounded-lg bg-surface shadow-card ${className}`}>
      {topStrip && <div className="px-4 pt-3">{topStrip}</div>}
      {(title || actions || eyebrow) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3">
          <div className="min-w-0">
            {eyebrow && <div className="label-caps mb-0.5">{eyebrow}</div>}
            {title && <h2 className="font-display text-base font-semibold text-ink-900 truncate">{title}</h2>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
      {footer && <footer className="border-t border-line bg-surface-2 px-4 py-2 text-xs text-ink-500">{footer}</footer>}
    </section>
  );
}

