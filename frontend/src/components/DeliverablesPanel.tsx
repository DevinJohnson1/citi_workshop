import { useCallback, useEffect, useState } from 'react';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import { overworkSuffix } from './OverworkBadge';
import type {
  Assignment,
  AssignmentRole,
  Deliverable,
  DeliverableStatus,
  Equipment,
  User,
} from '../types/api';

/**
 * Props for {@link DeliverablesPanel}.
 */
interface Props {
  /** The project whose deliverables are displayed and managed. */
  projectId: string;
}

const STATUSES: DeliverableStatus[] = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
const ASSIGNMENT_ROLES: AssignmentRole[] = ['owner', 'contributor', 'reviewer'];

/**
 * Deliverables panel on the project detail page.
 *
 * Approval workflow (UI convention — the `deliverables` table does NOT yet
 * carry an `approval_status` column; see SYSTEM_DESIGN §6):
 *   - team_member POSTs a new deliverable; it lands as `status='todo'`,
 *     which we present as "Awaiting team-lead approval".
 *   - team_lead PATCHes status → `in_progress` ("Approve") or `cancelled`
 *     ("Reject").
 *   - viewer / others: read-only.
 *
 * Each deliverable's expandable detail area shows:
 *   - **People**: members assigned to the deliverable via the `assignments`
 *     table (owner / contributor / reviewer).  Only `team_lead` users may
 *     hold the `owner` role — the backend enforces this.
 *   - **Tangibles / Intangibles**: equipment from the project's pool that has
 *     `assigned_deliverable_id` pointing at this deliverable.
 *
 * Only `team_lead` / `admin` can manage either set.  Backend authorisation
 * mirrors this in `assignments-service` and `equipment-service`.
 */
export function DeliverablesPanel({ projectId }: Props) {
  const { apiGet, apiPost, apiPatch, apiDelete } = useApi();
  const role = useRole();

  const canPropose = role === 'team_member' || role === 'team_lead' || role === 'admin';
  const canApprove = role === 'team_lead' || role === 'admin';
  /** Only leads / admin may link assets or assign members — mirrors backend auth. */
  const canManageLinks = canApprove;

  const [rows, setRows] = useState<Deliverable[]>([]);
  /** All equipment currently assigned to this project, used for asset linking. */
  const [projectEquipment, setProjectEquipment] = useState<Equipment[]>([]);
  /** All assignments belonging to deliverables on this project. */
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  /** All allocatable users on this project (used for the member picker). */
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /** Set of deliverable IDs whose detail panel is currently expanded. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /**
   * Per-deliverable: which equipment item is currently selected in the
   * "Link asset" picker.  Key = deliverable id, value = equipment id.
   */
  const [selectedToLink, setSelectedToLink] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<Record<string, boolean>>({});

  /**
   * Per-deliverable form state for the "Assign a member" picker.
   * Stored as flat maps keyed by deliverable id so each row is independent.
   */
  const [selectedUser, setSelectedUser] = useState<Record<string, string>>({});
  const [selectedRole, setSelectedRole] = useState<Record<string, AssignmentRole>>({});
  const [assigning, setAssigning] = useState<Record<string, boolean>>({});

  const reload = useCallback(() => {
    setLoading(true);
    // Four parallel requests so the panel renders in one render pass:
    //  1. deliverables on this project (primary list).
    //  2. equipment attached to this project, for the asset link picker.
    //  3. user catalogue, for member-assignment names + lead-role gating.
    //  4. assignments are filtered client-side from the project's
    //     deliverable ids; we fetch them in a second effect below to avoid
    //     a per-deliverable round trip.
    Promise.all([
      apiGet<ListResponse<Deliverable>>(
        `/deliverables-service?project_id=${encodeURIComponent(projectId)}`,
      ),
      apiGet<ListResponse<Equipment>>(
        `/equipment-service?assigned_project_id=${encodeURIComponent(projectId)}&limit=100`,
      ),
      apiGet<ListResponse<User>>('/resources-service'),
    ])
      .then(([res, eq, us]) => {
        setRows(res.data);
        setProjectEquipment(eq.data);
        setMembers(us.data);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet, projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * After the deliverables load, fetch assignments for each one in parallel
   * and merge.  We do this client-side because assignments-service has no
   * `project_id` filter — it's a deliverable↔user join table.  Failures are
   * silent: the People sections just appear empty if the call fails.
   */
  useEffect(() => {
    if (rows.length === 0) {
      setAssignments([]);
      return;
    }
    void Promise.all(
      rows.map((d) =>
        apiGet<ListResponse<Assignment>>(
          `/assignments-service?deliverable_id=${encodeURIComponent(d.id)}&limit=100`,
        ).then((resp) => resp.data),
      ),
    )
      .then((perDeliverable) => setAssignments(perDeliverable.flat()))
      .catch(() => {
        // Leave assignments empty — the rest of the panel still works.
      });
  }, [rows, apiGet]);

  /** Toggle the detail sub-panel open/closed for a given deliverable. */
  const toggleExpanded = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiPost<Deliverable>('/deliverables-service', {
        project_id: projectId,
        title: title.trim(),
        status: 'todo',
        due_date: dueDate || null,
      });
      setTitle('');
      setDueDate('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id: string, status: DeliverableStatus): Promise<void> => {
    setError(null);
    try {
      await apiPatch<Deliverable>(`/deliverables-service/${id}`, { status });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  /**
   * Associate an equipment item with a deliverable by patching its
   * `assigned_deliverable_id`.  The equipment stays on the project;
   * this just narrows it to a specific deliverable.
   */
  const handleLinkAsset = async (
    deliverableId: string,
    equipmentId: string,
  ): Promise<void> => {
    setLinking((prev) => ({ ...prev, [deliverableId]: true }));
    setError(null);
    try {
      await apiPatch<Equipment>(`/equipment-service/${equipmentId}`, {
        assigned_deliverable_id: deliverableId,
      });
      setSelectedToLink((prev) => ({ ...prev, [deliverableId]: '' }));
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setLinking((prev) => ({ ...prev, [deliverableId]: false }));
    }
  };

  /**
   * Remove the deliverable association from an equipment item (sets
   * `assigned_deliverable_id` back to `null`).  The item stays on the project.
   */
  const handleUnlinkAsset = async (equipmentId: string): Promise<void> => {
    setError(null);
    try {
      await apiPatch<Equipment>(`/equipment-service/${equipmentId}`, {
        assigned_deliverable_id: null,
      });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  /**
   * Assign a user to a deliverable in a specific role.  Reload everything on
   * success so the People section refreshes and the picker clears.
   */
  const handleAssignMember = async (deliverableId: string): Promise<void> => {
    const userId = selectedUser[deliverableId];
    const roleOnAssignment = selectedRole[deliverableId] ?? 'contributor';
    if (!userId) return;
    setAssigning((prev) => ({ ...prev, [deliverableId]: true }));
    setError(null);
    try {
      await apiPost<Assignment>('/assignments-service', {
        deliverable_id: deliverableId,
        user_id: userId,
        role_on_assignment: roleOnAssignment,
        percent: 100,
      });
      setSelectedUser((prev) => ({ ...prev, [deliverableId]: '' }));
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setAssigning((prev) => ({ ...prev, [deliverableId]: false }));
    }
  };

  /** Remove a member's assignment from a deliverable. */
  const handleRemoveAssignment = async (assignmentId: string): Promise<void> => {
    setError(null);
    try {
      await apiDelete(`/assignments-service/${assignmentId}`);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  /** Equipment items linked to a specific deliverable. */
  const assetsFor = (deliverableId: string): Equipment[] =>
    projectEquipment.filter((e) => e.assigned_deliverable_id === deliverableId);

  /** Assignments for a specific deliverable. */
  const assignmentsFor = (deliverableId: string): Assignment[] =>
    assignments.filter((a) => a.deliverable_id === deliverableId);

  /** User lookup helper for rendering assignee names. */
  const userById = (id: string): User | undefined => members.find((u) => u.id === id);

  /**
   * Equipment on this project that is not yet linked to any deliverable and
   * is not rejected — available to be picked in the link picker.
   */
  const unlinkedPool = projectEquipment.filter(
    (e) => e.assigned_deliverable_id === null && e.approval_status !== 'rejected',
  );

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-700">
            <tr>
              <th scope="col" className="px-3 py-2">Title</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2">Due</th>
              <th scope="col" className="px-3 py-2">People</th>
              <th scope="col" className="px-3 py-2">Assets</th>
              <th scope="col" className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-gray-500">
                  No deliverables yet.
                </td>
              </tr>
            )}
            {rows.flatMap((d) => {
              const awaiting = d.status === 'todo';
              const isExpanded = expanded.has(d.id);
              const linked = assetsFor(d.id);
              const tangibles = linked.filter((e) => e.is_tangible);
              const intangibles = linked.filter((e) => !e.is_tangible);
              const people = assignmentsFor(d.id);

              // Pool of users who can be added: project members not yet
              // assigned in any role on this deliverable.
              const alreadyAssignedIds = new Set(people.map((p) => p.user_id));
              const assignablePool = members.filter(
                (u) => !alreadyAssignedIds.has(u.id) && u.is_allocatable,
              );

              const mainRow = (
                <tr key={d.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">{d.title}</td>
                  <td className="px-3 py-2">
                    {d.status}
                    {awaiting && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        awaiting approval
                      </span>
                    )}
                    {d.is_outdated && (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                        overdue
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{d.due_date ?? '—'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(d.id)}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50"
                      aria-label={`Toggle people for ${d.title}`}
                    >
                      {people.length > 0 ? (
                        <span className="rounded-full bg-brand-100 px-1.5 text-brand-800">
                          {people.length}
                        </span>
                      ) : (
                        <span className="text-gray-400">none</span>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    {/* Toggle button showing asset count or "none" */}
                    <button
                      type="button"
                      onClick={() => toggleExpanded(d.id)}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50"
                      aria-expanded={isExpanded}
                    >
                      <span aria-hidden>{isExpanded ? '▾' : '▸'}</span>
                      {linked.length > 0 ? (
                        <span className="rounded-full bg-brand-100 px-1.5 text-brand-800">
                          {linked.length}
                        </span>
                      ) : (
                        <span className="text-gray-400">none</span>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    {canApprove && awaiting && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void updateStatus(d.id, 'in_progress')}
                          className="rounded bg-emerald-600 px-2 py-0.5 text-xs text-white hover:bg-emerald-700"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => void updateStatus(d.id, 'cancelled')}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {canApprove && !awaiting && (
                      <select
                        value={d.status}
                        onChange={(e) =>
                          void updateStatus(d.id, e.target.value as DeliverableStatus)
                        }
                        className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              );

              const assetRow = isExpanded ? (
                <tr key={`${d.id}-detail`} className="bg-gray-50">
                  <td colSpan={6} className="border-t border-gray-100 px-5 py-3">
                    <div className="space-y-4">

                      {/* People section */}
                      <div>
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          People
                        </h4>
                        {people.length === 0 ? (
                          <p className="text-xs text-gray-400">
                            No members assigned to this deliverable.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {people.map((p) => {
                              const u = userById(p.user_id);
                              const label = u
                                ? (u.full_name || u.email)
                                : p.user_id.slice(0, 8);
                              const roleBadge =
                                p.role_on_assignment === 'owner'
                                  ? 'border-purple-300 bg-purple-50 text-purple-800'
                                  : p.role_on_assignment === 'reviewer'
                                    ? 'border-sky-300 bg-sky-50 text-sky-800'
                                    : 'border-gray-200 bg-white text-gray-800';
                              return (
                                <span
                                  key={p.id}
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${roleBadge}`}
                                >
                                  <span className="font-medium">{label}</span>
                                  <span className="text-gray-400">·</span>
                                  <span>{p.role_on_assignment}</span>
                                  {canManageLinks && (
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveAssignment(p.id)}
                                      className="ml-0.5 text-gray-400 hover:text-red-600"
                                      title={`Remove ${label} from this deliverable`}
                                      aria-label={`Remove ${label}`}
                                    >
                                      ×
                                    </button>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}

                        {/* Member assignment picker (leads/admin only). */}
                        {canManageLinks && assignablePool.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-dashed border-gray-300 bg-white px-3 py-2">
                            <span className="text-xs text-gray-600">
                              Assign a member:
                            </span>
                            <select
                              value={selectedUser[d.id] ?? ''}
                              onChange={(e) =>
                                setSelectedUser((prev) => ({
                                  ...prev,
                                  [d.id]: e.target.value,
                                }))
                              }
                              className="rounded border border-gray-300 px-2 py-1 text-xs"
                              aria-label="Member to assign"
                            >
                              <option value="">— pick a member —</option>
                              {assignablePool.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.full_name || u.email}{u.role ? ` (${u.role})` : ''}{overworkSuffix(u)}
                                </option>
                              ))}
                            </select>
                            <select
                              value={selectedRole[d.id] ?? 'contributor'}
                              onChange={(e) =>
                                setSelectedRole((prev) => ({
                                  ...prev,
                                  [d.id]: e.target.value as AssignmentRole,
                                }))
                              }
                              className="rounded border border-gray-300 px-2 py-1 text-xs"
                              aria-label="Assignment role"
                              title="'owner' is restricted to users whose users.role = 'team_lead'"
                            >
                              {ASSIGNMENT_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={!selectedUser[d.id] || !!assigning[d.id]}
                              onClick={() => void handleAssignMember(d.id)}
                              className="rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {assigning[d.id] ? 'Assigning…' : 'Assign'}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Tangibles section */}
                      <div>
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Tangibles
                        </h4>
                        {tangibles.length === 0 ? (
                          <p className="text-xs text-gray-400">
                            No tangible assets linked to this deliverable.
                          </p>
                        ) : (
                          <AssetChipList
                            items={tangibles}
                            onUnlink={canManageLinks ? handleUnlinkAsset : undefined}
                          />
                        )}
                      </div>

                      {/* Intangibles section */}
                      <div>
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Intangibles
                        </h4>
                        {intangibles.length === 0 ? (
                          <p className="text-xs text-gray-400">
                            No intangible assets linked to this deliverable.
                          </p>
                        ) : (
                          <AssetChipList
                            items={intangibles}
                            onUnlink={canManageLinks ? handleUnlinkAsset : undefined}
                          />
                        )}
                      </div>

                      {/* Link picker — only leads/admin, only when there are
                          unlinked assets on the project to choose from */}
                      {canManageLinks && unlinkedPool.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 rounded border border-dashed border-gray-300 bg-white px-3 py-2">
                          <span className="text-xs text-gray-600">
                            Link a project asset to this deliverable:
                          </span>
                          <select
                            value={selectedToLink[d.id] ?? ''}
                            onChange={(e) =>
                              setSelectedToLink((prev) => ({
                                ...prev,
                                [d.id]: e.target.value,
                              }))
                            }
                            className="rounded border border-gray-300 px-2 py-1 text-xs"
                            aria-label="Asset to link to deliverable"
                          >
                            <option value="">— pick an asset —</option>
                            {unlinkedPool.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.is_tangible ? '📦' : '🔑'} {e.name} · {e.kind}
                                {e.cost != null ? ` · ${e.cost} ${e.currency}` : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!selectedToLink[d.id] || !!linking[d.id]}
                            onClick={() =>
                              void handleLinkAsset(d.id, selectedToLink[d.id]!)
                            }
                            className="rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {linking[d.id] ? 'Linking…' : 'Link'}
                          </button>
                        </div>
                      )}

                      {canManageLinks &&
                        unlinkedPool.length === 0 &&
                        linked.length === 0 && (
                          <p className="text-xs text-gray-400">
                            Add assets to this project's{' '}
                            <strong>Tangibles</strong> or{' '}
                            <strong>Intangibles</strong> tab first, then link
                            them here.
                          </p>
                        )}
                    </div>
                  </td>
                </tr>
              ) : null;

              return assetRow ? [mainRow, assetRow] : [mainRow];
            })}
          </tbody>
        </table>
      )}

      {canPropose && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="flex flex-wrap items-start gap-2 rounded border border-dashed border-gray-300 p-3"
        >
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              role === 'team_member'
                ? 'Propose a deliverable…'
                : 'New deliverable title'
            }
            className="min-w-56 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-44 flex-none rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="w-full rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {role === 'team_member' ? 'Submit for approval' : 'Add'}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Renders a horizontal list of equipment chips for a deliverable's asset
 * section.  An optional `onUnlink` callback adds an × button to each chip
 * so leads/admin can remove the association in one click.
 */
function AssetChipList({
  items,
  onUnlink,
}: {
  items: Equipment[];
  onUnlink?: (equipmentId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((e) => {
        const badge =
          e.approval_status === 'pending'
            ? 'border-amber-300 bg-amber-50'
            : e.approval_status === 'rejected'
              ? 'border-red-300 bg-red-50 opacity-60'
              : 'border-gray-200 bg-white';
        return (
          <span
            key={e.id}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${badge}`}
          >
            <span className="font-medium text-gray-800">{e.name}</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-500">{e.kind}</span>
            {e.cost != null && (
              <>
                <span className="text-gray-400">·</span>
                <span className="tabular-nums text-gray-600">
                  {e.cost} {e.currency}
                </span>
              </>
            )}
            {e.approval_status !== 'approved' && (
              <span className="ml-0.5 rounded bg-amber-100 px-1 text-amber-700">
                {e.approval_status}
              </span>
            )}
            {onUnlink && (
              <button
                type="button"
                onClick={() => onUnlink(e.id)}
                className="ml-0.5 text-gray-400 hover:text-red-600"
                title={`Unlink "${e.name}" from this deliverable`}
                aria-label={`Unlink ${e.name}`}
              >
                ×
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
