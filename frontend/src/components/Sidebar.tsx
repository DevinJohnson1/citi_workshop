import { NavLink } from 'react-router-dom';
import type { SessionRole } from '../auth/session';
import { roleLabel } from '../utils/labels';

/**
 * Sidebar — primary navigation rail, pinned to the viewport.
 *
 * ## Why this layout
 *
 * The sidebar lives next to `<main>` inside a flex row.  Flex children
 * stretch to the tallest sibling — so without an explicit height the rail
 * grew taller than the viewport when the canvas content was long, which
 * pushed the footer (version / sign-out) below the fold and hid it.
 * Two design moves prevent that:
 *
 *   1. `sticky top-0 h-[100dvh]` pins the aside to the viewport regardless
 *      of canvas height. `100dvh` (dynamic viewport height) accounts for
 *      mobile browser chrome that shrinks the visible area.
 *   2. Internally the aside is a flex column with the **nav region**
 *      claiming `flex-1 overflow-y-auto` — so when there are more nav
 *      items than the height allows, only that middle region scrolls,
 *      keeping the brand fixed at the top and the role/footer pinned at
 *      the bottom.
 *
 * ## Responsive modes (driven by parent via `mode` prop)
 *
 *   - `expanded` (default ≥1024 px)  → 224 px, full labels + section heads
 *   - `rail`     (768 – 1023 px)     → 64 px, icon-only with tooltip
 *   - `drawer`   (<768 px, opened)   → 240 px, slides over content
 *
 * Roles permitted to see each entry mirror the route guards in `App.tsx`;
 * do NOT change this matrix without updating the router. All semantic
 * meaning is preserved verbatim from the original NAV_ITEMS list.
 *
 * Purely presentational layout — the underlying React Router `NavLink`s
 * carry the actual routing behaviour, unchanged.
 */

export type SidebarMode = 'expanded' | 'rail' | 'drawer';

interface NavItem {
  to: string;
  label: string;
  /** Sub-label shown only in the expanded mode, beneath the label. */
  hint?: string;
  icon: React.ReactNode;
  roles: SessionRole[];
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface Props {
  /** Currently signed-in role, or null when public. */
  role: SessionRole | null;
  /** Visual mode — see component docstring. */
  mode: SidebarMode;
  /** Called after a nav item is selected (drawer closes itself etc.). */
  onNavigate?: () => void;
  /** Optional sign-out handler — surfaces a footer button when provided. */
  onSignOut?: () => void;
  /** Email of the signed-in user, shown next to the role chip in the footer. */
  email?: string;
}

/* =========================================================================
   Inline SVG icon set — no extra deps. 18 px box gives the icons a calmer
   stroke weight than the previous 16 px set inside a 20-px grid cell.
   ========================================================================= */
const Icon = {
  dashboard: (
    <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="6" height="9" rx="1.4" />
      <rect x="2.5" y="13"  width="6" height="4.5" rx="1.4" />
      <rect x="11.5" y="2.5" width="6" height="4.5" rx="1.4" />
      <rect x="11.5" y="8.5" width="6" height="9" rx="1.4" />
    </svg>
  ),
  projects: (
    <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 5.5h6l1.5 2h7.5v9.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5.5Z" />
      <path d="M2.5 9.5h15" />
    </svg>
  ),
  resources: (
    <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7.5" r="2.5" />
      <circle cx="14" cy="9" r="2" />
      <path d="M2.5 16c.5-2.5 2.4-4 4.5-4s4 1.5 4.5 4M12 16c.4-1.7 1.5-3 3-3s2.6 1.3 3 3" />
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 16V9M8 16V4M13 16v-5M18 16V7" />
    </svg>
  ),
  showcase: (
    <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3.5" width="16" height="11" rx="1.5" />
      <path d="M7.5 17.5h5M10 14.5v3" />
      <circle cx="10" cy="9" r="2.2" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="6" r="3" />
      <path d="M3.5 17c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
    </svg>
  ),
  signOut: (
    <svg viewBox="0 0 20 20" fill="none" className="h-[16px] w-[16px]" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 14.5 15 11l-3.5-3.5" />
      <path d="M15 11H6.5" />
      <path d="M11 3.5h3a1.5 1.5 0 0 1 1.5 1.5v2" />
      <path d="M11 17.5h3a1.5 1.5 0 0 0 1.5-1.5v-2" />
      <path d="M2.5 11V5a1.5 1.5 0 0 1 1.5-1.5h4" />
      <path d="M2.5 11v6a1.5 1.5 0 0 0 1.5 1.5h4" />
    </svg>
  ),
};

/**
 * Two groups so the rail has visual rhythm at the expanded width. The
 * Admin link sits in its own group at the bottom because, per the route
 * matrix in `App.tsx`, only `admin` ever sees it and they see *nothing
 * else* — so giving it its own group keeps that role's solo entry from
 * looking like an orphan.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', hint: 'Portfolio overview', icon: Icon.dashboard, roles: ['team_lead', 'team_member'] },
      { to: '/projects',  label: 'Projects',  hint: 'All engagements',    icon: Icon.projects,  roles: ['team_lead', 'team_member'] },
      { to: '/resources', label: 'Resources', hint: 'People & equipment', icon: Icon.resources, roles: ['team_lead', 'team_member'] },
      { to: '/reports',   label: 'Reports',   hint: 'Aggregates & risk',  icon: Icon.reports,   roles: ['team_lead', 'team_member', 'viewer'] },
      { to: '/showcase',  label: 'Showcase',  hint: 'Big-picture mode',   icon: Icon.showcase,  roles: ['team_lead', 'team_member', 'viewer'] },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/admin', label: 'Admin', hint: 'User management', icon: Icon.admin, roles: ['admin'] },
    ],
  },
];

export function Sidebar({ role, mode, onNavigate, onSignOut, email }: Props) {
  // Each group is filtered by the signed-in role; empty groups disappear
  // so we don't render a "Workspace" header above zero items.
  const visibleGroups = role
    ? NAV_GROUPS
        .map((g) => ({ ...g, items: g.items.filter((n) => n.roles.includes(role)) }))
        .filter((g) => g.items.length > 0)
    : [];

  const isRail   = mode === 'rail';
  const isDrawer = mode === 'drawer';
  const collapsed = isRail;
  // Drawer is always full-width-of-itself; rail is 64 px; expanded is 224 px.
  const width = isRail ? 'w-16' : 'w-56';
  // In drawer mode the parent positions us absolute/fixed; otherwise we are
  // a sticky pillar pinned to the top of the viewport, h-100dvh tall, so we
  // never overflow the screen even when the canvas is huge.
  const positioning = isDrawer
    ? 'h-[100dvh] w-60 shadow-pop'
    : 'sticky top-0 h-[100dvh] self-start';

  return (
    <aside
      className={`${positioning} ${isDrawer ? '' : width} flex shrink-0 flex-col border-r border-line bg-surface`}
      aria-label="Primary navigation"
    >
      {/* ---- Brand (fixed at top) -------------------------------------- */}
      <div className={`flex h-14 shrink-0 items-center gap-2 border-b border-line ${collapsed ? 'justify-center px-0' : 'px-3'}`}>
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-ink-900 font-mono text-[11px] font-bold tracking-tight text-mist">
          ▲C
        </span>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="font-display text-[13px] font-semibold text-ink-900">ACME</div>
            <div className="text-[10px] text-ink-400">Project Tracker</div>
          </div>
        )}
      </div>

      {/* ---- Nav (scrolls when overflowing) ---------------------------- */}
      <nav className="flex-1 overflow-y-auto overscroll-contain px-2 py-3">
        {visibleGroups.map((group, gi) => (
          <div key={group.title} className={gi > 0 ? 'mt-4 border-t border-line pt-4' : ''}>
            {!collapsed && (
              <div className="px-2 pb-1.5 label-caps">{group.title}</div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-2.5 rounded-md text-sm transition-colors ${
                        collapsed ? 'mx-auto h-10 w-10 justify-center' : 'px-2 py-1.5'
                      } ${
                        isActive
                          ? 'bg-brand-50 font-medium text-brand-700'
                          : 'text-ink-500 hover:bg-surface-2 hover:text-ink-900'
                      }`
                    }
                  >
                    {/* Active-state accent bar — visible in every mode. */}
                    {({ isActive }: { isActive: boolean }) => (
                      <>
                        {isActive && (
                          <span aria-hidden className={`absolute ${collapsed ? '-left-2 top-1/2 h-5 w-1 -translate-y-1/2' : '-left-2 top-1/2 h-5 w-1 -translate-y-1/2'} rounded-r-full bg-brand-600`} />
                        )}
                        <span aria-hidden className="grid shrink-0 place-items-center">
                          {item.icon}
                        </span>
                        {!collapsed && (
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* ---- Footer (pinned bottom) ------------------------------------ */}
      <div className={`shrink-0 border-t border-line ${collapsed ? 'p-2' : 'p-3'}`}>
        {role && (
          <div className={`mb-2 flex items-center gap-2 ${collapsed ? 'justify-center' : ''}`}>
            {/* Role chip — always visible, doubles as the identity affordance. */}
            <span
              className="inline-flex items-center rounded-full bg-ink-900 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-mist"
              title={email ? `Signed in as ${email}` : `Signed in as ${roleLabel(role)}`}
            >
              {collapsed ? roleLabel(role).slice(0, 2).toUpperCase() : roleLabel(role)}
            </span>
            {!collapsed && email && (
              <span className="min-w-0 truncate font-mono text-[10px] text-ink-400" title={email}>
                {email}
              </span>
            )}
          </div>
        )}

        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            className={`flex w-full items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-700 hover:bg-surface-2 hover:text-ember-700 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <span aria-hidden>{Icon.signOut}</span>
            {!collapsed && <span>Sign out</span>}
          </button>
        )}

        {!collapsed && (
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-ink-300">
            <span>v1.1</span>
            <span>Telemetry</span>
          </div>
        )}
      </div>
    </aside>
  );
}



