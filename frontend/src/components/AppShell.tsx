import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { clearSession, getSession, onSessionChange, type WorkshopSession } from '../auth/session';

interface Props {
  children: ReactNode;
}

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/projects', label: 'Projects' },
  { to: '/resources', label: 'Resources' },
  { to: '/reports', label: 'Reports' },
  { to: '/admin', label: 'Admin' },
];

/**
 * App shell — header with nav links and a sign-in / sign-out control wired
 * to the workshop's `auth/session.ts` store. Layout is responsive via
 * Tailwind: stacked nav < md, horizontal ≥ md.
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

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <Link to="/" className="text-lg font-semibold text-brand-700">
            ACME Project Tracker
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {navItems.map((item) => (
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
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
              >
                Sign out ({session.email || 'user'})
              </button>
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

