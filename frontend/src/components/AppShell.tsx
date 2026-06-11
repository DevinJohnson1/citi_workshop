import type { ReactNode } from 'react';
import { AppLayout } from './AppLayout';

/**
 * Legacy entry point — `App.tsx` imports `AppShell`, which the redesign
 * keeps as a thin alias delegating to the new {@link AppLayout}. The real
 * shell now lives in `AppLayout.tsx`; the sidebar in `Sidebar.tsx`; and
 * the command bar in `Topbar.tsx`.
 *
 * Keeping the file name and export shape avoids touching the router, which
 * the brief explicitly forbids changing.
 */
interface Props { children: ReactNode }

export function AppShell({ children }: Props) {
  return <AppLayout>{children}</AppLayout>;
}

