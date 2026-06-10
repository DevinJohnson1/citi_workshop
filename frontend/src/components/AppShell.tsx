import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  clearSession,
  getSession,
  onSessionChange,
  type SessionRole,
  type WorkshopSession,
} from '../auth/session';

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
    <div className="min-h-full flex flex-col">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <Link to="/" className="text-lg font-semibold text-brand-700">
            ACME Project Tracker
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {visibleNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive ? 'text-brand-700 font-medium' : 'text-gray-600 hover:text-gray-900'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="text-sm text-gray-600">
            {session ? (
              <div className="flex items-center gap-2">
                <span
                  className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
                  aria-label={`Signed in as ${session.role}`}
                >
                  {session.role}
                </span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
                >
                  Sign out ({session.email || 'user'})
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-gray-200 bg-white text-xs text-gray-500">
        <div className="mx-auto max-w-6xl px-4 py-3">v1.1 · SYSTEM_DESIGN-aligned</div>
      </footer>
    </div>
  );
}

