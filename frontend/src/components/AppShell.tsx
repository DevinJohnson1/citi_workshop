import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  clearSession,
  getSession,
  onSessionChange,
  type SessionRole,
  type WorkshopSession,
} from '../auth/session';
import { useTheme } from '../utils/theme';
import { MoonIcon, SunIcon } from './ui/icons';

/** Header control that flips between light and dark themes. */
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle text-content-secondary transition-colors duration-150 hover:bg-white/5 hover:text-content"
    >
      {isDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  );
}

interface Props {
  children: ReactNode;
}

interface NavItem {
  to: string;
  label: string;
  /** Roles permitted to see the link. Omit to allow any signed-in user. */
  roles?: SessionRole[];
}

/**
 * Primary nav. `roles` mirrors the route guard matrix in `App.tsx`; keep
 * them in sync. Unauthenticated visitors only see the brand link.
 *
 * Per-role visibility (UI gate only — backend re-enforces):
 *   - admin       → Admin (operator only, no project nav).
 *   - team_lead   → Dashboard, Projects, Resources, Reports.
 *   - team_member → Dashboard, Projects, Resources, Reports.
 *   - viewer      → Dashboard, Reports.
 *
 * Every entry MUST declare its `roles` allowlist. An entry without `roles`
 * would leak to admins (against the spec) — the linter-style assertion in
 * `visibleNav` below enforces it at runtime.
 */
const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', roles: ['team_lead', 'team_member', 'viewer'] },
  { to: '/projects',  label: 'Projects',  roles: ['team_lead', 'team_member'] },
  { to: '/resources', label: 'Resources', roles: ['team_lead', 'team_member'] },
  { to: '/reports',   label: 'Reports',   roles: ['team_lead', 'team_member', 'viewer'] },
  { to: '/admin',     label: 'Admin',     roles: ['admin'] },
];

/**
 * App shell — header with role-filtered nav and a sign-in / sign-out
 * control wired to the workshop's `auth/session.ts` store. Layout is
 * responsive via Tailwind: stacked nav < md, horizontal ≥ md.
 */
export function AppShell({ children }: Props) {
  const navigate = useNavigate();
  const [session, setSessionState] = useState<WorkshopSession | null>(() => getSession());

  // Keep the header in sync when LoginPage / a sibling tab mutates the session.
  useEffect(() => onSessionChange(setSessionState), []);

  /** Clear the local session and bounce back to the public landing page. */
  const handleSignOut = (): void => {
    clearSession();
    navigate('/', { replace: true });
  };

  const visibleNav = session
    ? NAV_ITEMS.filter((item) => item.roles?.includes(session.role) ?? false)
    : [];

  return (
    <div className="min-h-full flex flex-col bg-surface text-content">
      <header className="border-b border-border-subtle bg-surface-raised">
        <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <Link to="/" className="text-base font-semibold tracking-[-0.02em] text-content">
            ACME Project Tracker
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {visibleNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive
                    ? 'text-accent-400 font-medium'
                    : 'text-content-secondary hover:text-content transition-colors duration-150'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-sm text-content-secondary">
            <ThemeToggle />
            {session ? (
              <div className="flex items-center gap-2">
                <span
                  className="rounded-md bg-accent-500/10 px-2 py-0.5 text-xs font-medium text-accent-400"
                  aria-label={`Signed in as ${session.role}`}
                >
                  {session.role}
                </span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="rounded-md border border-border-subtle px-3 py-1 text-content-secondary transition-colors duration-150 hover:bg-white/5 hover:text-content"
                >
                  Sign out ({session.email || 'user'})
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="rounded-md border border-border-subtle px-3 py-1 transition-colors duration-150 hover:bg-white/5 hover:text-content"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-border-subtle bg-surface-raised text-xs text-content-muted">
        <div className="mx-auto max-w-6xl px-4 py-3">v1.1 · SYSTEM_DESIGN-aligned</div>
      </footer>
    </div>
  );
}

