import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useCurrentUser } from '../auth/useCurrentUser';
import type { Role, User } from '../types/api';
import { roleLabel } from '../utils/labels';
import { Avatar } from '../components/ui/AvatarStack';
import { SortableHeader } from '../components/ui/SortableHeader';
import { useSortableTable } from '../utils/useSortableTable';

/** Roles a non-admin row can be promoted/demoted to (matches backend `PromotableRole`). */
const PROMOTABLE_ROLES: Role[] = ['team_lead', 'team_member', 'viewer'];

/** Phrase the operator must retype to release the destructive delete. */
const DELETE_CONFIRMATION_PHRASE = 'DELETE';

interface RoleSection {
  role: Role;
  heading: string;
  blurb: string;
  /**
   * True when the Allocatable checkbox is interactive for this role.
   * The column itself is **always rendered** so every section's table
   * has the same column geometry — viewer/admin rows just show a dimmed
   * "n/a" instead of a checkbox.
   */
  allocatableEditable: boolean;
  /** True when role / delete controls are usable on this table. */
  editable: boolean;
  /**
   * Tailwind class fragment used for the role badge + the accent strip on
   * the left of each section header. Keeps the four sections visually
   * distinct without resorting to icons.
   */
  accentBg: string;
  accentText: string;
  accentBar: string;
}

/**
 * Order in which the per-role sections render. Admin is last because admin
 * rows are read-only here (managed out-of-band) — putting them at the top
 * would visually bury the actionable tables.
 */
const ROLE_SECTIONS: RoleSection[] = [
  {
    role: 'team_lead',
    heading: 'Team leads',
    blurb: 'Own projects, approve team-member requests, manage allocations.',
    allocatableEditable: true,
    editable: true,
    accentBg: 'bg-brand-50',
    accentText: 'text-brand-700',
    accentBar: 'bg-brand-500',
  },
  {
    role: 'team_member',
    heading: 'Team members',
    blurb: 'Contribute to projects; allocations and equipment requests need a lead\u2019s approval.',
    allocatableEditable: true,
    editable: true,
    accentBg: 'bg-jade-50',
    accentText: 'text-jade-700',
    accentBar: 'bg-jade-500',
  },
  {
    role: 'viewer',
    heading: 'Viewers',
    blurb: 'Read-only access to the dashboard and reports. Viewers are never allocatable.',
    allocatableEditable: false,
    editable: true,
    accentBg: 'bg-sky-50',
    accentText: 'text-sky-700',
    accentBar: 'bg-sky-500',
  },
  {
    role: 'admin',
    heading: 'Admins',
    blurb: 'Managed out-of-band — role and allocatability are not editable from this page.',
    allocatableEditable: false,
    editable: false,
    accentBg: 'bg-violet-50',
    accentText: 'text-violet-700',
    accentBar: 'bg-violet-500',
  },
];

/**
 * Admin landing — manages the user directory exposed by
 * `/api/resources-service`. UI is admin-gated by `ProtectedRoute`; the
 * backend re-enforces in `_lib/auth.py`.
 *
 * Layout: a summary strip across the top (per-role totals + allocatable
 * count), a global filter that narrows every section by name/email/role,
 * then one table per role (team_lead / team_member / viewer / admin).
 * The Allocatable column is hidden on the viewer and admin tables because
 * the flag is meaningless for those roles — viewers are read-only by spec
 * (backend rejects `is_allocatable=true` on a viewer row), and admins are
 * not project workers. Demoting anyone to viewer auto-clears the flag
 * server-side.
 *
 * The role `<select>` excludes `admin` to match the backend
 * `PromotableRole` Literal — admins are provisioned out-of-band, not via
 * the API. Admin rows render the select disabled.
 *
 * Destructive actions (delete) require a typed-phrase confirmation in an
 * inline alertdialog — a usability guard against muscle-memory double
 * clicks. The backend role check is the real boundary.
 */
export function AdminPage() {
  const { apiGet, apiPatch, apiDelete } = useApi();
  const me = useCurrentUser();
  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  // Inline delete confirmation — `deleteTarget` is the row awaiting
  // confirmation, `confirmText` mirrors the input. The destructive button
  // only unlocks when `confirmText === DELETE_CONFIRMATION_PHRASE`.
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    apiGet<ListResponse<User>>('/resources-service?all=true&limit=100')
      .then((res) => setRows(res.data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Apply the search filter once, then bucket by role. The filter is
  // case-insensitive substring across email, full_name, and role label so
  // typing "lead" surfaces every team_lead while "@acme" surfaces every
  // user on that domain. Empty filter is a no-op.
  const needle = filter.trim().toLowerCase();
  const filteredRows = useMemo<User[]>(() => {
    if (!needle) return rows;
    return rows.filter((u) =>
      u.email.toLowerCase().includes(needle) ||
      (u.full_name && u.full_name.toLowerCase().includes(needle)) ||
      roleLabel(u.role).toLowerCase().includes(needle),
    );
  }, [rows, needle]);

  const rowsByRole = useMemo<Record<Role, User[]>>(() => {
    const buckets: Record<Role, User[]> = {
      admin: [], team_lead: [], team_member: [], viewer: [],
    };
    for (const u of filteredRows) {
      buckets[u.role]?.push(u);
    }
    return buckets;
  }, [filteredRows]);

  /** Totals across the full (unfiltered) directory — drives the header strip. */
  const totals = useMemo(() => {
    const t: Record<Role, number> = { admin: 0, team_lead: 0, team_member: 0, viewer: 0 };
    let allocatable = 0;
    for (const u of rows) {
      t[u.role] = (t[u.role] ?? 0) + 1;
      if (u.is_allocatable) allocatable++;
    }
    return { byRole: t, allocatable, total: rows.length };
  }, [rows]);

  /** Apply a partial update and optimistically refresh the row. */
  const patchUser = async (
    id: string,
    body: Partial<Pick<User, 'role' | 'is_allocatable'>>,
  ): Promise<void> => {
    setPendingId(id);
    setError(null);
    try {
      const updated = await apiPatch<User>(`/resources-service/${id}`, body);
      setRows((prev) => prev.map((u) => (u.id === id ? { ...u, ...updated } : u)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setPendingId(null);
    }
  };

  /**
   * Hard-delete the currently-targeted account. Pre-conditions are guarded
   * by the UI (typed confirmation, can't delete self, can't delete admins)
   * and re-enforced server-side. On success we splice the row out locally
   * rather than re-fetching the whole list.
   */
  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    if (confirmText !== DELETE_CONFIRMATION_PHRASE) return;
    setPendingId(deleteTarget.id);
    setError(null);
    try {
      await apiDelete(`/resources-service/${deleteTarget.id}`);
      setRows((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
      setConfirmText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
          Admin · users &amp; roles
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Promote, demote, or flip allocatability for any non-admin account.
          Admin accounts are provisioned out-of-band and cannot be promoted
          to, demoted, or deleted from this page.
        </p>
      </header>

      {/* Summary strip — keeps the operator oriented as the directory grows. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="Total accounts" value={totals.total} />
        <SummaryCard label="Allocatable" value={totals.allocatable} hint="leads + members" />
        {ROLE_SECTIONS.map((s) => (
          <SummaryCard
            key={s.role}
            label={s.heading}
            value={totals.byRole[s.role]}
            accent={`${s.accentBg} ${s.accentText}`}
          />
        ))}
      </div>

      {/* Global filter — narrows every section in one shot. */}
      <div className="rounded-lg border border-line bg-surface p-3 shadow-card">
        <label className="block text-sm">
          <span className="label-caps">Filter</span>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by name, email, or role…"
            className="mt-1 block w-full rounded border border-line-strong px-3 py-2 text-sm"
            aria-label="Filter users"
          />
          {needle && (
            <span className="mt-1 block text-xs text-ink-500">
              Showing {filteredRows.length} of {totals.total}
              {filteredRows.length === 0 && ' — try a shorter query'}
            </span>
          )}
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded border border-ember-100 bg-ember-50 px-3 py-2 text-sm text-ember-700">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-ink-400">Loading…</p>}

      {!loading && !error && ROLE_SECTIONS.map((section) => (
        <RoleTable
          key={section.role}
          section={section}
          rows={rowsByRole[section.role]}
          meId={me?.id ?? null}
          pendingId={pendingId}
          onPatch={patchUser}
          onRequestDelete={(u) => {
            setDeleteTarget(u);
            setConfirmText('');
          }}
        />
      ))}

      {/* Inline delete confirmation — typed-phrase guard. */}
      {deleteTarget && (
        <div
          role="alertdialog"
          aria-labelledby="admin-delete-title"
          aria-describedby="admin-delete-desc"
          className="rounded-lg border border-ember-100 bg-ember-50/60 p-4 text-sm shadow-card"
        >
          <h2 id="admin-delete-title" className="font-display text-base font-semibold text-ember-700">
            Delete {deleteTarget.full_name || deleteTarget.email}?
          </h2>
          <p id="admin-delete-desc" className="mt-1 text-ember-700">
            This removes the database account immediately. The Cognito sign-in
            is deliberately <em>not</em> revoked — pair this with a Cognito
            user-pool action if you mean to lock them out completely.
          </p>
          <label className="mt-3 block">
            <span className="text-ember-700">
              Type <code className="rounded bg-ember-100 px-1 font-mono">{DELETE_CONFIRMATION_PHRASE}</code> to confirm:
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-label={`Type ${DELETE_CONFIRMATION_PHRASE} to confirm deletion`}
              className="mt-1 block w-full rounded-md border border-ember-100 bg-surface px-2 py-1.5 font-mono"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={
                confirmText !== DELETE_CONFIRMATION_PHRASE ||
                pendingId === deleteTarget.id
              }
              className="rounded-md bg-ember-500 px-3 py-1.5 font-medium text-white hover:bg-ember-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingId === deleteTarget.id ? 'Deleting…' : 'Delete permanently'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleteTarget(null);
                setConfirmText('');
              }}
              disabled={pendingId === deleteTarget.id}
              className="rounded-md border border-line bg-surface px-3 py-1.5 hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// SummaryCard — top-strip KPI tile
// ---------------------------------------------------------------------------

/**
 * Compact tile showing a single integer KPI. The optional `accent`
 * recolours the value background to match the role section it mirrors,
 * tying the strip back to the tables below.
 */
function SummaryCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className={`rounded-lg border border-line p-3 shadow-card ${accent ?? 'bg-surface'}`}>
      <div className="label-caps">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-400">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoleTable — one table per role section
// ---------------------------------------------------------------------------

interface RoleTableProps {
  section: RoleSection;
  rows: User[];
  meId: string | null;
  pendingId: string | null;
  onPatch: (id: string, body: Partial<Pick<User, 'role' | 'is_allocatable'>>) => Promise<void>;
  onRequestDelete: (target: User) => void;
}

/**
 * A single role's table.
 *
 * Every table renders the **same five columns** (Email, Name, Role,
 * Allocatable, Actions) with the **same column widths** — driven by a
 * shared `<colgroup>` plus `table-fixed` layout — so the four sections
 * stack with their columns visually aligned. Controls that aren't
 * applicable for a given role (Allocatable on viewers/admins, role/delete
 * on admins) render a dimmed "n/a" placeholder instead of disappearing,
 * which keeps the columns truthful AND uniformly spaced.
 *
 * The whole section is **collapsible** — the header is a real `<button>`
 * with `aria-expanded` so keyboard / screen-reader users can toggle it.
 * Collapse uses the CSS grid 0fr → 1fr trick on `<div>` wrappers, which
 * animates `height: auto` cleanly without measuring DOM size in JS.
 */
function RoleTable({ section, rows, meId, pendingId, onPatch, onRequestDelete }: RoleTableProps) {
  const { role, heading, blurb, allocatableEditable, editable, accentBg, accentText, accentBar } = section;
  // Persist open/closed in component state. Default open so the directory
  // is visible without an extra click — collapse is opt-in.
  const [open, setOpen] = useState(true);

  const { sorted, sort, setSort } = useSortableTable(rows, {
    email:       (u) => u.email,
    name:        (u) => u.full_name ?? '',
    role:        (u) => roleLabel(u.role),
    allocatable: (u) => (u.is_allocatable ? 1 : 0),
  }, { key: 'email', dir: 'asc' });

  const panelId = `admin-section-${role}`;
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      {/* Section header is the toggle. The accent bar, heading, count
          pill, and blurb stay where they were — only the chevron + the
          aria-expanded semantics are new. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left hover:bg-surface-2"
      >
        <span aria-hidden className={`mt-0.5 h-10 w-1 shrink-0 rounded-full ${accentBar}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-display text-base font-semibold text-ink-900">{heading}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${accentBg} ${accentText}`}>
              {rows.length}
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-ink-500">{blurb}</span>
        </span>
        <Chevron open={open} />
      </button>

      {/* Collapse via grid 0fr → 1fr — the inner overflow-hidden wrapper
          clips the table during the transition so it feels like a real
          drop-down. Honours prefers-reduced-motion through the global
          rule in index.css. */}
      <div
        id={panelId}
        role="region"
        aria-label={`${heading} table`}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="overflow-x-auto">
            {/* `table-fixed` plus the shared <colgroup> below force every
                section's columns to land on the same vertical gridlines,
                regardless of content length. min-width keeps the layout
                from collapsing on very narrow viewports — the wrapping
                div handles horizontal scroll past that point. */}
            <table className="w-full min-w-[720px] table-fixed text-sm">
              <colgroup>
                <col className="w-[32%]" /> {/* Email   */}
                <col className="w-[20%]" /> {/* Name    */}
                <col className="w-[22%]" /> {/* Role    */}
                <col className="w-[14%]" /> {/* Alloc.  */}
                <col className="w-[12%]" /> {/* Actions */}
              </colgroup>
              <thead className="bg-surface-2 text-left text-ink-700">
                <tr>
                  <SortableHeader sortKey="email"       sort={sort} setSort={setSort}>Email</SortableHeader>
                  <SortableHeader sortKey="name"        sort={sort} setSort={setSort}>Name</SortableHeader>
                  <SortableHeader sortKey="role"        sort={sort} setSort={setSort}>Role</SortableHeader>
                  <SortableHeader sortKey="allocatable" sort={sort} setSort={setSort}>Allocatable</SortableHeader>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-5 text-ink-400">
                      No {heading.toLowerCase()}.
                    </td>
                  </tr>
                )}
                {sorted.map((u) => {
                  const isSelf = meId === u.id;
                  const rowPending = pendingId === u.id;
                  const deleteDisabled = rowPending || !editable || isSelf;
                  const deleteTitle = isSelf
                    ? "You can't delete your own account"
                    : !editable
                      ? 'Admin accounts cannot be deleted via this page'
                      : 'Delete this account (Cognito sign-in is NOT removed)';
                  return (
                    <tr
                      key={u.id}
                      className={`border-t border-line transition-colors hover:bg-surface-2 ${
                        isSelf ? 'bg-brand-50/40' : ''
                      }`}
                    >
                      <td className="px-4 py-2.5 align-middle">
                        <span className="flex items-center gap-2">
                          <Avatar name={u.full_name} email={u.email} hueKey={u.id} size="sm" />
                          <span className="truncate">{u.email}</span>
                          {isSelf && (
                            <span
                              className="rounded-full bg-brand-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-brand-700 ring-1 ring-inset ring-brand-100"
                              title="This is the account you're signed in as"
                            >
                              you
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 align-middle truncate">
                        {u.full_name || <span className="text-ink-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 align-middle">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${accentBg} ${accentText}`}
                            aria-hidden
                          >
                            {roleLabel(u.role)}
                          </span>
                          <select
                            value={u.role}
                            disabled={rowPending || !editable}
                            onChange={(e) => void onPatch(u.id, { role: e.target.value as Role })}
                            aria-label={`Change role for ${u.email}`}
                            className="rounded border border-line-strong px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-surface-2"
                          >
                            {/* Admin rows show the current `admin` option but are disabled.
                                Non-admin rows offer only the three promotable roles. */}
                            {editable
                              ? PROMOTABLE_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)
                              : <option value={role}>{roleLabel(role)}</option>}
                          </select>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 align-middle">
                        {allocatableEditable ? (
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={u.is_allocatable}
                              disabled={rowPending || !editable}
                              onChange={(e) => void onPatch(u.id, { is_allocatable: e.target.checked })}
                              aria-label={`Allocatable for ${u.email}`}
                            />
                            <span className="text-xs text-ink-500">
                              {u.is_allocatable ? 'yes' : 'no'}
                            </span>
                          </label>
                        ) : (
                          // Viewer / admin rows: the checkbox would be a lie
                          // (backend rejects the flip), so we render a
                          // dimmed placeholder that keeps the column width
                          // in sync with the editable tables.
                          <span className="text-xs text-ink-300" title="Not applicable for this role">
                            n/a
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-middle">
                        <button
                          type="button"
                          onClick={() => onRequestDelete(u)}
                          disabled={deleteDisabled}
                          title={deleteTitle}
                          className="rounded border border-ember-100 px-2 py-1 text-xs text-ember-700 hover:bg-ember-50 disabled:cursor-not-allowed disabled:border-line disabled:text-ink-300 disabled:hover:bg-transparent"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Caret that rotates 180° when the panel is expanded. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className={`mt-1 h-3 w-3 shrink-0 text-ink-400 transition-transform duration-200 ${
        open ? 'rotate-180' : ''
      }`}
      fill="currentColor"
    >
      <path d="M6 8 2 4h8L6 8Z" />
    </svg>
  );
}





