import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { clearSession, getSession, onSessionChange, type WorkshopSession } from '../auth/session';

/**
 * AppLayout — the composed shell wrapping every routed page.
 *
 * Layout strategy (driven by react-responsive):
 *  - ≥ 1024 px: expanded sidebar (224 px) + topbar + canvas
 *  - 768–1023 px: icon rail (64 px)  + topbar + canvas
 *  - < 768 px: sidebar hidden by default, slides out as a drawer when
 *              the topbar's menu button is pressed; backdrop click
 *              dismisses.
 *
 * The sidebar itself is `sticky top-0 h-[100dvh]` (see `Sidebar.tsx`) so
 * it never grows past the viewport even when the canvas content is very
 * tall. AppLayout's job is just to slot it next to `<main>` and feed it
 * the right `mode` for the current breakpoint.
 *
 * Auth state lives here and is propagated by props to keep `Topbar` and
 * `Sidebar` purely presentational.
 *
 * Public routes (`/`, `/login`, `/login/callback`) render WITHOUT the
 * sidebar — they get a focused, full-width canvas with just the topbar.
 */
interface Props {
  children: ReactNode;
}

const PUBLIC_PATHS = new Set(['/', '/login', '/login/callback']);

export function AppLayout({ children }: Props) {
  const navigate = useNavigate();
  const [session, setSession] = useState<WorkshopSession | null>(() => getSession());
  useEffect(() => onSessionChange(setSession), []);

  // Three breakpoints — desktop (expanded), tablet (rail), mobile (drawer).
  const isDesktop = useMediaQuery({ minWidth: 1024 });
  const isTablet  = useMediaQuery({ minWidth: 768, maxWidth: 1023 });
  const isMobile  = useMediaQuery({ maxWidth: 767 });

  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Auto-close the mobile drawer on route change.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const isPublic = PUBLIC_PATHS.has(location.pathname);
  // Kiosk mode (Showcase) renders edge-to-edge: no sidebar, no topbar, dark
  // canvas. The page itself owns its chrome (exit button, scene controls).
  const isKiosk = location.pathname.startsWith('/showcase');
  const showSidebar = !!session && !isPublic && !isKiosk;

  /** Single sign-out helper — used by both the sidebar footer and the topbar. */
  const handleSignOut = () => {
    clearSession();
    navigate('/', { replace: true });
  };

  // Resolve the sidebar mode for the *persistent* desktop/tablet rail.
  // Drawer mode is used only inside the mobile overlay below.
  const persistentMode = isDesktop ? 'expanded' : isTablet ? 'rail' : null;

  return (
    <div className="min-h-full">
      {isKiosk && session ? (
        /* Showcase — full-bleed, no chrome. Page owns its own background. */
        <div className="min-h-full">{children}</div>
      ) : showSidebar ? (
        <div className="flex min-h-full">
          {/* Persistent sidebar — desktop & tablet only. */}
          {persistentMode && (
            <Sidebar
              role={session!.role}
              mode={persistentMode}
              email={session!.email}
              onSignOut={handleSignOut}
            />
          )}

          {/* Mobile drawer — fixed-position overlay, only when toggled open. */}
          {isMobile && mobileOpen && (
            <>
              <div
                aria-hidden
                onClick={() => setMobileOpen(false)}
                className="fixed inset-0 z-30 bg-ink-900/50 backdrop-blur-[1px]"
              />
              <div className="fixed inset-y-0 left-0 z-40">
                <Sidebar
                  role={session!.role}
                  mode="drawer"
                  email={session!.email}
                  onNavigate={() => setMobileOpen(false)}
                  onSignOut={handleSignOut}
                />
              </div>
            </>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar
              session={session}
              onMobileMenu={isMobile ? () => setMobileOpen(true) : undefined}
            />
            <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
              <div className="mx-auto w-full max-w-7xl">{children}</div>
            </main>
          </div>
        </div>
      ) : (
        /* Public / unauthenticated chrome — topbar only, full-width canvas. */
        <div className="flex min-h-full flex-col">
          <Topbar session={session} />
          <main className="flex-1 px-4 py-10 sm:px-6">
            <div className="mx-auto w-full max-w-3xl">{children}</div>
          </main>
        </div>
      )}
    </div>
  );
}



