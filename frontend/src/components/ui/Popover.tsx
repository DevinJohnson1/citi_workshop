import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

type Align = 'start' | 'center' | 'end';

interface PopoverProps {
  /** The trigger element. Must accept a ref + onClick (a button works best). */
  trigger: ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
    'aria-expanded'?: boolean;
    'aria-haspopup'?: boolean | 'dialog' | 'menu' | 'listbox';
  }>;
  /** Popover body. Receives a `close` callback for action-then-dismiss flows. */
  children: (close: () => void) => ReactNode;
  align?: Align;
  /** Extra classes for the floating panel. */
  className?: string;
  /** ARIA role for the panel. Defaults to dialog. */
  role?: 'dialog' | 'menu' | 'listbox';
}

/**
 * Hand-built popover — no dependency. Handles outside-click + Escape
 * dismissal, fixed positioning anchored to the trigger (so it escapes
 * `overflow-hidden` table cells), and basic focus return to the trigger on
 * close. Entrance animation comes from `.animate-popover-in` in index.css.
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  className = '',
  role = 'dialog',
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; minWidth: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  // Position the panel under the trigger using viewport coordinates so it is
  // not clipped by scrollable / overflow-hidden ancestors.
  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = r.left;
    if (align === 'center') left = r.left + r.width / 2;
    if (align === 'end') left = r.right;
    setCoords({ top: r.bottom + 6, left, minWidth: r.width });
  }, [align]);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => reposition();
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, reposition]);

  const triggerEl = isValidElement(trigger)
    ? cloneElement(trigger, {
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node;
        },
        onClick: (e: React.MouseEvent) => {
          trigger.props.onClick?.(e);
          setOpen((v) => !v);
        },
        'aria-expanded': open,
        'aria-haspopup': role,
      } as Record<string, unknown>)
    : trigger;

  const translateX =
    align === 'center' ? '-translate-x-1/2' : align === 'end' ? '-translate-x-full' : '';

  return (
    <>
      {triggerEl}
      {open && coords && (
        <div
          ref={panelRef}
          id={panelId}
          role={role}
          style={{ position: 'fixed', top: coords.top, left: coords.left }}
          className={`animate-popover-in z-50 ${translateX} rounded-lg border border-border-subtle bg-surface-overlay p-1 shadow-xl shadow-black/20 ${className}`}
        >
          {children(close)}
        </div>
      )}
    </>
  );
}
