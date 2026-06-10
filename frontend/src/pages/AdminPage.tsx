import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useCurrentUser } from '../auth/useCurrentUser';
import type { Role, User } from '../types/api';

/** Roles a non-admin row can be promoted/demoted to (matches backend `PromotableRole`). */
const PROMOTABLE_ROLES: Role[] = ['team_lead', 'team_member', 'viewer'];

/**
 * Order in which the per-role sections render. Admin is last because admin
 * rows are read-only here (managed out-of-band) — putting them at the top
 * would visually bury the actionable tables.
 */
const ROLE_SECTIONS: Array<{
  role: Role;
  heading: string;
  blurb: string;
  /** True when the Allocatable column has meaning for this role. */
  showAllocatable: boolean;
  /** True when role / allocatable / delete controls are usable on this table. */
  editable: boolean;
}> = [
  {
    role: 'team_lead',
    heading: 'Team leads',
    blurb: 'Own projects, approve team-member requests, manage allocations.',
    showAllocatable: true,
    editable: true,
  },
  {
    role: 'team_member',
    heading: 'Team members',
    blurb: 'Contribute to projects; allocations and equipment requests need a lead\u2019s approval.',
    showAllocatable: true,
    editable: true,
  },
  {
    role: 'viewer',
    heading: 'Viewers',
    blurb: 'Read-only access to the dashboard and reports. Viewers are never allocatable.',
    showAllocatable: false,
    editable: true,
  },
  {
    role: 'admin',
    heading: 'Admins',
    blurb: 'Managed out-of-band — role and allocatability are not editable from this page.',
    showAllocatable: false,
    editable: false,
  },
];

/**
 * Admin landing — manages the user directory exposed by
 * `/api/resources-service`. UI is admin-gated by `ProtectedRoute`; the
 * backend re-enforces in `_lib/auth.py`.
 *
 * Layout: one table per role (team_lead / team_member / viewer / admin).
 * The Allocatable column is hidden on the viewer and admin tables because
 * the flag is meaningless for those roles — viewers are read-only by spec
 * (backend rejects `is_allocatable=true` on a viewer row), and admins are
 * not project workers. Demoting anyone to viewer auto-clears the flag
 * server-side.
 *
 * The role `<select>` excludes `admin` to match the backend
 * `PromotableRole` Literal — admins are provisioned out-of-band, not via
 * the API. Admin rows render the select disabled.
 */
export function AdminPage() {
  const { apiGet, apiPatch, apiDelete } = useApi();
  const me = useCurrentUser();
  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

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

  // Bucket rows by role once per `rows` change so each table doesn't re-filter
  // on every render. Order inside each bucket is whatever the backend returned
  // (currently `full_name NULLS LAST, email`).
  const rowsByRole = useMemo<Record<Role, User[]>>(() => {
    const buckets: Record<Role, User[]> = {
      admin: [], team_lead: [], team_member: [], viewer: [],
    };
    for (const u of rows) {
      buckets[u.role]?.push(u);
    }
    return buckets;
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
   * Hard-delete an account. Confirms first because the action is irreversible
   * at the DB level (the Cognito user is deliberately NOT removed — see
   * `resources-service._delete` docstring). On success we splice the row out
   * locally rather than re-fetching the whole list.
   */
  const deleteUser = async (target: User): Promise<void> => {
    const label = target.full_name || target.email;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) {
      return;
    }
    setPendingId(target.id);
    setError(null);
    try {
      await apiDelete(`/resources-service/${target.id}`);
      setRows((prev) => prev.filter((u) => u.id !== target.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Admin — users &amp; roles</h1>
        <p className="text-sm text-gray-600">
          Promote, demote, or flip allocatability for any non-admin account.
          Admin accounts are managed out-of-band and cannot be promoted-to,
          demoted, or deleted via this page.
        </p>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {!loading && !error && ROLE_SECTIONS.map((section) => (
        <RoleTable
          key={section.role}
          section={section}
          rows={rowsByRole[section.role]}
          meId={me?.id ?? null}
          pendingId={pendingId}
          onPatch={patchUser}
          onDelete={deleteUser}
        />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// RoleTable — one table per role section
// ---------------------------------------------------------------------------

interface RoleTableProps {
  section: (typeof ROLE_SECTIONS)[number];
  rows: User[];
  meId: string | null;
  pendingId: string | null;
  onPatch: (id: string, body: Partial<Pick<User, 'role' | 'is_allocatable'>>) => Promise<void>;
  onDelete: (target: User) => Promise<void>;
}

/**
 * A single role's table. Column set depends on `section.showAllocatable`.
 * For admin rows the section is non-editable (controls disabled) and the
 * delete button is suppressed — matches the backend rules.
 */
function RoleTable({ section, rows, meId, pendingId, onPatch, onDelete }: RoleTableProps) {
  const { role, heading, blurb, showAllocatable, editable } = section;
  const columnCount = 3 + (showAllocatable ? 1 : 0) + (editable ? 1 : 0);

  return (
    <div className="space-y-2">
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold">{heading}</h2>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
          {rows.length}
        </span>
        <span className="text-xs text-gray-500">{blurb}</span>
      </header>

      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-700">
            <tr>
              <th scope="col" className="px-3 py-2">Email</th>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">Role</th>
              {showAllocatable && <th scope="col" className="px-3 py-2">Allocatable</th>}
              {editable && <th scope="col" className="px-3 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-3 py-4 text-gray-500">
                  No {heading.toLowerCase()}.
                </td>
              </tr>
            )}
            {rows.map((u) => {
              const isSelf = meId === u.id;
              const rowPending = pendingId === u.id;
              const deleteDisabled = rowPending || !editable || isSelf;
              const deleteTitle = isSelf
                ? "You can't delete your own account"
                : !editable
                  ? 'Admin accounts cannot be deleted via this page'
                  : 'Delete this account (Cognito sign-in is NOT removed)';
              return (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">{u.full_name || '—'}</td>
                  <td className="px-3 py-2">
                    <select
                      value={u.role}
                      disabled={rowPending || !editable}
                      onChange={(e) => void onPatch(u.id, { role: e.target.value as Role })}
                      className="rounded border border-gray-300 px-2 py-1 disabled:cursor-not-allowed disabled:bg-gray-100"
                    >
                      {/* Admin rows show the current `admin` option but are disabled.
                          Non-admin rows offer only the three promotable roles. */}
                      {editable
                        ? PROMOTABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)
                        : <option value={role}>{role}</option>}
                    </select>
                  </td>
                  {showAllocatable && (
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={u.is_allocatable}
                          disabled={rowPending || !editable}
                          onChange={(e) => void onPatch(u.id, { is_allocatable: e.target.checked })}
                        />
                        <span className="text-xs text-gray-600">
                          {u.is_allocatable ? 'yes' : 'no'}
                        </span>
                      </label>
                    </td>
                  )}
                  {editable && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void onDelete(u)}
                        disabled={deleteDisabled}
                        title={deleteTitle}
                        className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

