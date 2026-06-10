import type { ReactNode } from 'react';
import { XIcon } from './icons';

/** Pulsing skeleton block that matches content shape. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/5 ${className}`} />;
}

/** A row of skeletons mimicking a deliverable row. */
export function DeliverableRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-3 py-3">
      <Skeleton className="h-4 w-4" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-5 w-24" />
      <div className="ml-auto flex items-center gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-6 w-6 rounded-full" />
      </div>
    </div>
  );
}

/** Quiet empty placeholder — icon + single helper line + optional action. */
export function EmptyState({
  icon,
  message,
  action,
}: {
  icon: ReactNode;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-subtle px-4 py-10 text-center">
      <span className="text-content-muted">{icon}</span>
      <p className="text-[13px] text-content-secondary">{message}</p>
      {action}
    </div>
  );
}

/** Inline, dismissible error banner — never a full-page error. */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg border border-status-blocked/20 bg-status-blocked/10 px-3 py-2 text-[13px] text-status-blocked"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="shrink-0 rounded p-0.5 text-status-blocked/70 transition-colors duration-150 hover:text-status-blocked"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
