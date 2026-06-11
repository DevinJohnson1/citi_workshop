import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi, type ListResponse } from '../services/apiClient';
import type { WorkshopSession } from '../auth/session';
import type { Deliverable, Project } from '../types/api';
import { HealthStrip } from './ui/HealthStrip';
import { Avatar } from './ui/AvatarStack';
import { useTheme } from '../utils/theme';

/**
 * Topbar — sticky command bar above the main canvas.
 *
 * Contents (left → right):
 *   - Mobile menu toggle (mobile only)
 *   - Portfolio Health Pulse — Telemetry's signature element, populated by
 *     the live deliverables feed; falls back to project at-risk count when
 *     deliverables fail to load.
 *   - Quick-jump search input (visual-only, hooks straight into the
 *     Projects list route via `?q=` — preserves the existing list filter
 *     contract, no new API).
 *   - Signed-in user's avatar bubble (sign-out + role badge live in the
 *     Sidebar; the topbar is intentionally chrome-light).
 *
 * Receives the live session as a prop so the layout owns auth state and
 * the topbar stays purely presentational.
 */
interface Props {
  session: WorkshopSession | null;
  /** Mobile-drawer trigger; layout owns the open/close state. */
  onMobileMenu?: () => void;
}

export function Topbar({ session, onMobileMenu }: Props) {
  const navigate = useNavigate();
  const { apiGet } = useApi();
  const { theme, toggleTheme } = useTheme();
  const [deliverables, setDeliverables] = useState<Deliverable[] | null>(null);
  const [atRiskCount, setAtRiskCount] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  // Hydrate the Health Pulse once per session. Failures stay silent —
  // the strip falls back to an empty/at-risk-only render.
  useEffect(() => {
    if (!session) return;
    apiGet<ListResponse<Deliverable>>('/deliverables-service?limit=200')
      .then((r) => setDeliverables(r.data))
      .catch(() => setDeliverables([]));
    apiGet<{ data: Project[] }>('/reports-service/at-risk')
      .then((r) => setAtRiskCount(r.data.length))
      .catch(() => setAtRiskCount(null));
  }, [apiGet, session]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `/projects?q=${encodeURIComponent(trimmed)}` : '/projects');
  };

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
        {onMobileMenu && (
          <button
            type="button"
            onClick={onMobileMenu}
            className="grid h-9 w-9 place-items-center rounded-md text-ink-500 hover:bg-surface-2 md:hidden"
            aria-label="Open navigation"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" fill="none">
              <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {/* Portfolio Health Pulse — the signature strip. */}
        <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
          <div className="label-caps shrink-0">Portfolio</div>
          <div className="min-w-0 flex-1">
            <HealthStrip deliverables={deliverables ?? []} height={3} />
          </div>
          {atRiskCount !== null && (
            <div className={`shrink-0 rounded-full px-2 py-0.5 font-mono tnum text-[11px] ring-1 ring-inset ${
              atRiskCount > 0
                ? 'bg-ember-50 text-ember-700 ring-ember-100'
                : 'bg-jade-50 text-jade-700 ring-jade-100'
            }`}>
              {atRiskCount > 0 ? `${atRiskCount} at risk` : 'all on track'}
            </div>
          )}
        </div>

        {/* Quick-jump search — route-driven, no new API. */}
        {session && (
          <form onSubmit={handleSearchSubmit} className="ml-auto hidden sm:block" role="search">
            <label className="relative block">
              <span className="sr-only">Search projects</span>
              <svg viewBox="0 0 20 20" aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="9" cy="9" r="5" />
                <path d="m13 13 3.5 3.5" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to project…"
                className="w-56 rounded-md border border-line bg-surface-2 py-1.5 pl-8 pr-2 text-sm placeholder:text-ink-300 focus:border-brand-500 lg:w-72"
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1 font-mono text-[10px] text-ink-400 lg:block">
                ↵
              </kbd>
            </label>
          </form>
        )}

        {/* Auth control — just the user's avatar bubble when signed in.
            Sign-out and the role badge are reachable from the Sidebar. */}
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          {/* Light/dark mode toggle — persisted per-browser via localStorage. */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="grid h-9 w-9 place-items-center rounded-md text-ink-500 hover:bg-surface-2 hover:text-ink-700"
          >
            {theme === 'dark' ? (
              // Sun icon — clicking returns to light mode.
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="10" cy="10" r="3.2" />
                <path strokeLinecap="round" d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
              </svg>
            ) : (
              // Moon icon — clicking goes to dark mode.
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M16.3 12.8a6.5 6.5 0 0 1-9.1-9.1.7.7 0 0 0-.9-.9 8 8 0 1 0 10.9 10.9.7.7 0 0 0-.9-.9Z" />
              </svg>
            )}
          </button>

          {session ? (
            <Avatar
              email={session.email}
              hueKey={session.email}
              size="sm"
              className="ring-2 ring-surface"
            />
          ) : (
            <Link
              to="/login"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}




