import { useCallback, useEffect, useState } from 'react';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import { useCurrentUser } from '../auth/useCurrentUser';
import { overworkSuffix } from './OverworkBadge';
import { StatusBadge } from './ui/StatusBadge';
import { SortableHeader } from './ui/SortableHeader';
import { useSortableTable } from '../utils/useSortableTable';
import { prettyLabel, roleLabel } from '../utils/labels';
import type {
  Allocation,
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
  /** Owner of the project — gates create access for non-owning leads/members. */
  ownerId: string;
  /**
   * Full set of project lead ids (owner + co-leads). Any user in this list
   * with the `team_lead` role gets the same write authority as the owner.
   * Optional for backwards compat; when omitted, falls back to `[ownerId]`.
   */
  leadIds?: string[];
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
 *     table (owner / contributor / reviewer).  Any allocated user — lead
 *     or member — may hold any of the three roles; "owner" is the common
 *     case for the team_member doing the work.
 *   - **Tangibles / Intangibles**: equipment from the project's pool that has
 *     `assigned_deliverable_id` pointing at this deliverable.
 *
 * Only `team_lead` / `admin` can manage either set.  Backend authorisation
 * mirrors this in `assignments-service` and `equipment-service`.
 */
export function DeliverablesPanel({ projectId, ownerId, leadIds }: Props) {
  const { apiGet, apiPost, apiPatch, apiDelete } = useApi();
  const role = useRole();
  const me = useCurrentUser();

  const isOwningLead = role === 'team_lead' && me !== null && (leadIds && leadIds.length > 0 ? leadIds : [ownerId]).includes(me.id);
  const isAdmin = role === 'admin';
  // The create form (and the backend) require: admin, owning lead, or a
  // contributor (lead/member) with an approved allocation on THIS project.
  // The `hasApprovedAllocation` half is computed below once projectAllocations
  // is loaded — until then the gate is closed for non-owners.
  const baseCanPropose = isAdmin || isOwningLead;
  const canApprove = role === 'team_lead' || role === 'admin';
  /**
   * Only the **owning** lead (or any admin) may link assets or assign
   * members. Mirrors `assignments-service._create` and `equipment-service`,
   * both of which reject non-owning leads with 403 — so we hide the picker
   * to prevent dead-end clicks. Owning leads can assign any user holding an
   * approved allocation on this project (including other team_leads).
   */
  const canManageLinks = isOwningLead || isAdmin;

  const [rows, setRows] = useState<Deliverable[]>([]);
  /** All equipment currently assigned to this project, used for asset linking. */
  const [projectEquipment, setProjectEquipment] = useState<Equipment[]>([]);
  /** All assignments belonging to deliverables on this project. */
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  /** All allocatable users on this project (used for the member picker). */
  const [members, setMembers] = useState<User[]>([]);
  /**
   * Approved allocations on *this* project. Used to gate the assignment
   * picker — backend rule: a user must already hold an approved allocation
   * here before they can be put on any of the project's deliverables.
   */
  const [projectAllocations, setProjectAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  /**
   * `depends_on` for the create form. Empty string = "no prerequisite";
   * any other value is the chosen parent deliverable's id. Lives at the
   * panel level so it's reset alongside title/dueDate after submit.
   */
  const [dependsOnDraft, setDependsOnDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /**
   * Per-row "Depends on" editor state for leads / admin. When a row id
   * appears as a key, the inline picker is open and the value is the
   * pending parent id ('' = clear the dependency). Closes on save.
   */
  const [editingDependsOn, setEditingDependsOn] = useState<Record<string, string>>({});
  const [savingDependsOn, setSavingDependsOn] = useState<Record<string, boolean>>({});

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
      // Approved allocations on this project — feeds the member-picker
      // gate. Backend (assignments-service) rejects any assignment whose
      // user_id lacks one of these rows, so we must not offer them in the UI.
      apiGet<ListResponse<Allocation>>(
        `/allocations-service?project_id=${encodeURIComponent(projectId)}&approval_status=approved&limit=200`,
      ),
    ])
      .then(([res, eq, us, allocs]) => {
        setRows(res.data);
        setProjectEquipment(eq.data);
        setMembers(us.data);
        setProjectAllocations(allocs.data);
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
        // Only forward depends_on when the picker actually has a value —
        // omitting the key altogether keeps the column NULL (= root node)
        // and avoids triggering the backend's depends_on validator for
        // no reason.
        ...(dependsOnDraft ? { depends_on: dependsOnDraft } : {}),
      });
      setTitle('');
      setDueDate('');
      setDependsOnDraft('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Persist a new depends_on choice for an existing deliverable. Empty
   * string clears the dependency (NULL); a UUID points at the chosen
   * parent. The backend enforces same-project + no-cycle rules; this
   * just hands the value off and reloads on success.
   */
  const saveDependsOn = async (deliverableId: string): Promise<void> => {
    const next = editingDependsOn[deliverableId] ?? '';
    setSavingDependsOn((prev) => ({ ...prev, [deliverableId]: true }));
    setError(null);
    try {
      await apiPatch<Deliverable>(`/deliverables-service/${deliverableId}`, {
        depends_on: next === '' ? null : next,
      });
      setEditingDependsOn((prev) => {
        const { [deliverableId]: _drop, ...rest } = prev;
        return rest;
      });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSavingDependsOn((prev) => ({ ...prev, [deliverableId]: false }));
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

  /** Deliverable title lookup — feeds the "depends on" parent label + pickers. */
  const deliverableById = (id: string): Deliverable | undefined =>
    rows.find((d) => d.id === id);

  /**
   * Equipment on this project that is not yet linked to any deliverable and
   * is not rejected — available to be picked in the link picker.
   */
  const unlinkedPool = projectEquipment.filter(
    (e) => e.assigned_deliverable_id === null && e.approval_status !== 'rejected',
  );

  /**
   * The caller themselves has an approved allocation on *this* project.
   * Together with admin / owning-lead this opens the create form per the
   * backend's deliverables-service._create rule.
   */
  const isAllocatedHere = me !== null && projectAllocations.some(
    (a) => a.user_id === me.id,
  );
  const canPropose = baseCanPropose || (
    (role === 'team_member' || role === 'team_lead') && isAllocatedHere
  );

  // Sortable columns. People/Assets/Actions stay as plain headers since
  // their values are not naturally comparable (counts + buttons).
  const { sorted, sort, setSort } = useSortableTable(rows, {
    title:  (d) => d.title,
    status: (d) => d.status,
    due:    (d) => d.due_date ?? '',
  }, { key: 'title', dir: 'asc' });

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-ember-500">{error}</p>}

      {loading ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : (
        // Horizontal scroll wrapper mirrors BudgetPanel / ProjectEquipmentPanel
        // so the rightmost columns (Actions / Assets / Due) don't break out of
        // the card on narrow viewports. Without it, the table's intrinsic
        // width pushes past the parent and visually "pops off" the surface.
        <div className="overflow-x-auto rounded border border-line bg-surface">
          <table className="min-w-full text-sm">
          <thead className="bg-surface-2 text-left text-ink-700">
            <tr>
              <SortableHeader sortKey="title"  sort={sort} setSort={setSort}>Title</SortableHeader>
              <SortableHeader sortKey="status" sort={sort} setSort={setSort}>Status</SortableHeader>
              <SortableHeader sortKey="due"    sort={sort} setSort={setSort}>Due</SortableHeader>
              <th scope="col" className="px-4 py-2.5 font-semibold">People</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Assets</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-5 text-ink-400">
                  No deliverables yet.
                </td>
              </tr>
            )}
            {sorted.flatMap((d) => {
              const awaiting = d.status === 'todo';
              const isExpanded = expanded.has(d.id);
              const linked = assetsFor(d.id);
              const tangibles = linked.filter((e) => e.is_tangible);
              const intangibles = linked.filter((e) => !e.is_tangible);
              const people = assignmentsFor(d.id);

              // Pool of users who can be added: project members not yet
              // assigned in any role on this deliverable, AND who hold an
              // approved allocation on this project (mirrors the backend
              // capacity gate in assignments-service._create).
              const alreadyAssignedIds = new Set(people.map((p) => p.user_id));
              const allocatedUserIds = new Set(projectAllocations.map((a) => a.user_id));
              const assignablePool = members.filter(
                (u) =>
                  !alreadyAssignedIds.has(u.id) &&
                  u.is_allocatable &&
                  allocatedUserIds.has(u.id),
              );

              const mainRow = (
                <tr key={d.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <div>{d.title}</div>
                    {/* Dependency display + inline editor. The parent (if any)
                        is shown as a small "↳ depends on:" line. Leads / admin
                        get an Edit affordance that swaps in a <select> with
                        every *other* deliverable on this project; the backend
                        rejects same-project violations and cycles, so the
                        picker stays simple and just hides this row itself. */}
                    <DependencyCell
                      deliverable={d}
                      allDeliverables={rows}
                      parent={d.depends_on ? deliverableById(d.depends_on) : undefined}
                      canEdit={canManageLinks}
                      isEditing={editingDependsOn[d.id] !== undefined}
                      pendingValue={editingDependsOn[d.id] ?? d.depends_on ?? ''}
                      saving={!!savingDependsOn[d.id]}
                      onStartEdit={() =>
                        setEditingDependsOn((prev) => ({
                          ...prev,
                          [d.id]: d.depends_on ?? '',
                        }))
                      }
                      onChange={(v) =>
                        setEditingDependsOn((prev) => ({ ...prev, [d.id]: v }))
                      }
                      onCancel={() =>
                        setEditingDependsOn((prev) => {
                          const { [d.id]: _drop, ...rest } = prev;
                          return rest;
                        })
                      }
                      onSave={() => void saveDependsOn(d.id)}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    {/* Flex-wrap so the secondary "Awaiting" / "Overdue"
                        pills tuck under the StatusBadge on narrow viewports
                        instead of pushing the cell wider. `whitespace-nowrap`
                        keeps each pill's label intact (no mid-word breaks). */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={d.status} />
                      {awaiting && (
                        <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                          Awaiting approval
                        </span>
                      )}
                      {d.is_outdated && (
                        <span className="whitespace-nowrap rounded bg-ember-100 px-1.5 py-0.5 text-xs text-ember-700">
                          Overdue
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">{d.due_date ?? '—'}</td>
                  <td className="px-4 py-2.5">
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
                        <span className="text-ink-300">none</span>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
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
                        <span className="text-ink-300">none</span>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    {canApprove && awaiting && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void updateStatus(d.id, 'in_progress')}
                          className="rounded bg-jade-500 px-2 py-0.5 text-xs text-white hover:bg-jade-700"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => void updateStatus(d.id, 'cancelled')}
                          className="rounded border border-line-strong px-2 py-0.5 text-xs hover:bg-surface-2"
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
                        className="rounded border border-line-strong px-1 py-0.5 text-xs"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {prettyLabel(s)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              );

              const assetRow = isExpanded ? (
                <tr key={`${d.id}-detail`} className="bg-surface-2">
                  <td colSpan={6} className="border-t border-line px-5 py-3">
                    <div className="space-y-4">

                      {/* People section */}
                      <div>
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                          People
                        </h4>
                        {people.length === 0 ? (
                          <p className="text-xs text-ink-300">
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
                                  ? 'border-violet-100 bg-violet-50 text-violet-700'
                                  : p.role_on_assignment === 'reviewer'
                                    ? 'border-sky-100 bg-sky-50 text-sky-700'
                                    : 'border-line bg-surface text-ink-700';
                              return (
                                <span
                                  key={p.id}
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${roleBadge}`}
                                >
                                  <span className="font-medium">{label}</span>
                                  <span className="text-ink-300">·</span>
                                  <span>{prettyLabel(p.role_on_assignment)}</span>
                                  {canManageLinks && (
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveAssignment(p.id)}
                                      className="ml-0.5 text-ink-300 hover:text-ember-500"
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
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-dashed border-line-strong bg-surface px-3 py-2">
                            <span className="text-xs text-ink-500">
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
                              className="rounded border border-line-strong px-2 py-1 text-xs"
                              aria-label="Member to assign"
                            >
                              <option value="">— pick a member —</option>
                              {assignablePool.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.full_name || u.email}{u.role ? ` (${roleLabel(u.role)})` : ''}{overworkSuffix(u)}
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
                              className="rounded border border-line-strong px-2 py-1 text-xs"
                              aria-label="Assignment role"
                              title="Any allocated user (lead or member) may hold any role, including 'owner'."
                            >
                              {ASSIGNMENT_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {prettyLabel(r)}
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
                        {/* Capacity-gate hint: the picker hides when nobody
                            on the project is still unassigned, so explain
                            why. Distinguishes "everyone's already on it"
                            from "the project has no approved allocations
                            yet" — the latter requires a trip to Allocations
                            before any assignment can happen. */}
                        {canManageLinks && assignablePool.length === 0 && (
                          <p className="mt-2 rounded border border-dashed border-line-strong bg-surface-2 px-3 py-2 text-xs text-ink-500">
                            {projectAllocations.length === 0
                              ? 'No one is allocated to this project yet — add an approved allocation under Allocations before assigning members to deliverables.'
                              : people.length >= projectAllocations.length
                                ? 'Every allocated member is already assigned to this deliverable.'
                                : 'No remaining allocated members are available to assign.'}
                          </p>
                        )}
                      </div>

                      {/* Tangibles section */}
                      <div>
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                          Tangibles
                        </h4>
                        {tangibles.length === 0 ? (
                          <p className="text-xs text-ink-300">
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
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                          Intangibles
                        </h4>
                        {intangibles.length === 0 ? (
                          <p className="text-xs text-ink-300">
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
                        <div className="flex flex-wrap items-center gap-2 rounded border border-dashed border-line-strong bg-surface px-3 py-2">
                          <span className="text-xs text-ink-500">
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
                            className="rounded border border-line-strong px-2 py-1 text-xs"
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
                          <p className="text-xs text-ink-300">
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
        </div>
      )}

      {canPropose && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="flex flex-wrap items-start gap-2 rounded border border-dashed border-line-strong p-3"
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
            className="min-w-56 flex-1 rounded border border-line-strong px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-44 flex-none rounded border border-line-strong px-2 py-1.5 text-sm"
          />
          {/* Optional prerequisite. Pre-populated with this project's existing
              deliverables; "— no prerequisite —" = root node. Members can also
              pick a parent — the backend will accept it and the lead can edit
              later via the inline editor on the row. */}
          <select
            value={dependsOnDraft}
            onChange={(e) => setDependsOnDraft(e.target.value)}
            className="min-w-48 flex-1 rounded border border-line-strong px-2 py-1.5 text-sm"
            aria-label="Depends on (prerequisite deliverable)"
            title="Optional: which existing deliverable must finish before this one can start"
          >
            <option value="">— no prerequisite (root) —</option>
            {rows.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="w-full rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {role === 'team_member' ? 'Submit for approval' : 'Add'}
          </button>
        </form>
      )}

      {/* Soft gate hint: viewers and non-allocated leads/members see the
          rationale instead of the create form, with a pointer to the
          Allocations tab where they can ask to be added to the project. */}
      {!canPropose && (role === 'team_lead' || role === 'team_member') && !loading && (
        <p className="rounded border border-dashed border-line-strong bg-surface-2 px-3 py-2 text-xs text-ink-500">
          You can only add deliverables to projects you've been allocated to.
          Open the <strong>Allocations</strong> tab and request to join this
          project — once the owning lead approves your allocation, you'll be
          able to propose deliverables here.
        </p>
      )}
    </div>
  );
}

/**
 * Inline display + editor for `deliverable.depends_on`. Renders the
 * parent's title (or an em-dash for roots) as a small "↳ depends on:"
 * line under the deliverable's own title; when the caller flips
 * `isEditing` on, swaps in a <select> populated with every *other*
 * deliverable on the same project. The backend (deliverables-service
 * `_validate_depends_on`) enforces same-project and no-cycle rules, so
 * this picker stays simple — it only excludes the deliverable itself
 * from the option list as a courtesy.
 */
function DependencyCell({
  deliverable,
  allDeliverables,
  parent,
  canEdit,
  isEditing,
  pendingValue,
  saving,
  onStartEdit,
  onChange,
  onCancel,
  onSave,
}: {
  deliverable: Deliverable;
  allDeliverables: Deliverable[];
  parent: Deliverable | undefined;
  canEdit: boolean;
  isEditing: boolean;
  pendingValue: string;
  saving: boolean;
  onStartEdit: () => void;
  onChange: (next: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (isEditing) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-ink-400" aria-hidden>↳ depends on</span>
        <select
          value={pendingValue}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-line-strong px-1.5 py-0.5 text-xs"
          aria-label="Prerequisite deliverable"
        >
          <option value="">— none (root) —</option>
          {allDeliverables
            .filter((d) => d.id !== deliverable.id)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
        </select>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded border border-line-strong px-2 py-0.5 text-xs text-ink-700 hover:bg-surface-2 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-400">
      <span aria-hidden>↳ depends on:</span>
      {parent ? (
        <span className="truncate text-ink-700" title={parent.title}>{parent.title}</span>
      ) : (
        <span className="text-ink-300">—</span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={onStartEdit}
          className="rounded px-1.5 py-0.5 text-[11px] text-brand-700 hover:bg-brand-50"
          aria-label={`Edit prerequisite for ${deliverable.title}`}
        >
          edit
        </button>
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
            ? 'border-amber-100 bg-amber-50'
            : e.approval_status === 'rejected'
              ? 'border-ember-100 bg-ember-50 opacity-60'
              : 'border-line bg-surface';
        return (
          <span
            key={e.id}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${badge}`}
          >
            <span className="font-medium text-ink-700">{e.name}</span>
            <span className="text-ink-300">·</span>
            <span className="text-ink-400">{e.kind}</span>
            {e.cost != null && (
              <>
                <span className="text-ink-300">·</span>
                <span className="tabular-nums text-ink-500">
                  {e.cost} {e.currency}
                </span>
              </>
            )}
            {e.approval_status !== 'approved' && (
              <span className="ml-0.5 rounded bg-amber-100 px-1 text-amber-700">
                {prettyLabel(e.approval_status)}
              </span>
            )}
            {onUnlink && (
              <button
                type="button"
                onClick={() => onUnlink(e.id)}
                className="ml-0.5 text-ink-300 hover:text-ember-500"
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
