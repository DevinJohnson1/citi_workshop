import { useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

interface TooltipProps {
  label: ReactNode;
  children: ReactElement;
}

/**
 * Lightweight hover/focus tooltip. Renders inline (absolutely positioned
 * above the trigger). Adds `aria-describedby` for screen readers and shows
 * on both pointer hover and keyboard focus.
 */
export function Tooltip({ label, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    timer.current = setTimeout(() => setOpen(true), 120);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          id={id}
          className="animate-popover-in pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border-subtle bg-surface-overlay px-2 py-1 text-[11px] font-medium text-content shadow-lg shadow-black/20"
        >
          {label}
        </span>
      )}
    </span>
  );
}
