import { useCallback, useEffect, useState } from 'react';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import type {
  Assignment,
  AssignmentRole,
  Deliverable,
  DeliverableStatus,
  Equipment,
  User,
} from '../types/api';
import { StatusPill, StatusSelectPill, STATUS_ORDER } from './ui/StatusPill';
import { AssigneeStack } from './ui/AssigneeStack';
import { PriorityIcon, derivePriority } from './ui/PriorityIcon';
import { formatRelativeDue } from '../utils/relativeDate';
import { DeliverableRowSkeleton, EmptyState, ErrorBanner } from './ui/feedback';
import {
  BoxIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  InboxIcon,
  KeyIcon,
  PlusIcon,
  XIcon,
} from './ui/icons';

/**
 * Props for {@link DeliverablesPanel}.
 */
interface Props {
  /** The project whose deliverables are displayed and managed. */
  projectId: string;
}

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
 * UI overhaul notes:
 *   - Status is rendered as an interactive {@link StatusSelectPill}; for
 *     leads/admin it opens an inline popover instead of a native <select>.
 *   - Assignees use the shared {@link AssigneeStack} (avatar stack +
 *     keyboard combobox). Controls are hidden at rest and revealed on row
 *     hover.
 *   - Priority is *derived* from existing fields (is_outdated / due_date) —
 *     the schema has no priority column. Tags are derived from linked asset
 *     kinds. Neither changes the data contract.
 *   - All original event handlers (create, status patch, link/unlink asset,
 *     assign/remove member) are preserved verbatim.
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

  /** Per-deliverable assigning-in-flight flags (combobox quick-assign). */
  const [assigning, setAssigning] = useState<Record<string, boolean>>({});

  const reload = useCallback(() => {
    setLoading(true);
    // Three parallel requests so the panel renders in one render pass:
    //  1. deliverables on this project (primary list).
    //  2. equipment attached to this project, for the asset link picker.
    //  3. user catalogue, for member-assignment names + lead-role gating.
    // Assignments are loaded in a follow-up effect (no project_id filter).
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
    // Optimistic update: flip the pill immediately, roll back on failure so
    // the popover feels instant without changing the underlying contract.
    const prevRows = rows;
    setRows((rs) => rs.map((d) => (d.id === id ? { ...d, status } : d)));
    setError(null);
    try {
      await apiPatch<Deliverable>(`/deliverables-service/${id}`, { status });
      reload();
    } catch (err) {
      setRows(prevRows);
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
   * The combobox does not surface a role selector, so we default to
   * `contributor` (the backend restricts `owner` to team_leads anyway).
   */
  const handleAssignMember = async (
    deliverableId: string,
    userId: string,
    roleOnAssignment: AssignmentRole = 'contributor',
  ): Promise<void> => {
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
  const nameFor = (id: string): string => {
    const u = userById(id);
    return u ? u.full_name || u.email : id.slice(0, 8);
  };

  /**
   * Equipment on this project that is not yet linked to any deliverable and
   * is not rejected — available to be picked in the link picker.
   */
  const unlinkedPool = projectEquipment.filter(
    (e) => e.assigned_deliverable_id === null && e.approval_status !== 'rejected',
  );

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {loading ? (
        <div className="space-y-2">
          <DeliverableRowSkeleton />
          <DeliverableRowSkeleton />
          <DeliverableRowSkeleton />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<InboxIcon size={28} />}
          message="No deliverables yet."
          action={
            canPropose ? (
              <span className="text-[11px] text-content-muted">
                Add one below to get started.
              </span>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((d) => {
            const awaiting = d.status === 'todo';
            const isExpanded = expanded.has(d.id);
            const linked = assetsFor(d.id);
            const tangibles = linked.filter((e) => e.is_tangible);
            const intangibles = linked.filter((e) => !e.is_tangible);
            const people = assignmentsFor(d.id);
            const due = formatRelativeDue(d.due_date);
            const priority = derivePriority(d);

            // Tags derived from linked asset kinds (no schema change). Unique,
            // capped at 2 with a +N overflow chip in the metadata row.
            const tags = Array.from(new Set(linked.map((e) => e.kind)));

            // Pool of users who can be added: project members not yet
            // assigned in any role on this deliverable.
            const alreadyAssignedIds = new Set(people.map((p) => p.user_id));
            const assignablePool = members.filter(
              (u) => !alreadyAssignedIds.has(u.id) && u.is_allocatable,
            );

            return (
              <li
                key={d.id}
                className="group rounded-lg border border-border-subtle bg-surface-raised transition-colors duration-150 hover:border-border-strong"
              >
                {/* ---- Main row ---- */}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(d.id)}
                    aria-expanded={isExpanded}
                    aria-label={`Toggle details for ${d.title}`}
                    className="shrink-0 rounded p-0.5 text-content-muted transition-transform duration-150 hover:text-content"
                    style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  >
                    <ChevronRightIcon size={15} />
                  </button>

                  <PriorityIcon priority={priority} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold leading-tight tracking-[-0.02em] text-content">
                      {d.title}
                    </p>
                    {/* Metadata row — single line, degrades gracefully. */}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-medium text-content-secondary">
                      {due && (
                        <span
                          className={`inline-flex items-center gap-1 ${
                            due.overdue ? 'text-status-blocked' : ''
                          }`}
                        >
                          <CalendarIcon size={12} />
                          {due.text}
                        </span>
                      )}
                      {awaiting && (
                        <span className="rounded bg-status-progress/10 px-1.5 py-0.5 text-[10px] text-status-progress">
                          Awaiting approval
                        </span>
                      )}
                      {tags.slice(0, 2).map((t) => (
                        <span
                          key={t}
                          className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-content-secondary"
                        >
                          {t}
                        </span>
                      ))}
                      {tags.length > 2 && (
                        <span className="text-[10px] text-content-muted">
                          +{tags.length - 2}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Assignee stack — reveal manage controls on row hover. */}
                  <div className="shrink-0">
                    <AssigneeStack
                      assignments={people}
                      nameFor={nameFor}
                      assignablePool={assignablePool}
                      canManage={canManageLinks && !assigning[d.id]}
                      onAssign={(userId) => void handleAssignMember(d.id, userId)}
                      onRemove={(assignmentId) => void handleRemoveAssignment(assignmentId)}
                    />
                  </div>

                  {/* Status — interactive pill for leads/admin, read-only otherwise. */}
                  <div className="shrink-0">
                    {canApprove ? (
                      <StatusSelectPill
                        status={d.status}
                        options={STATUS_ORDER}
                        onChange={(next) => void updateStatus(d.id, next)}
                      />
                    ) : (
                      <StatusPill status={d.status} />
                    )}
                  </div>

                  {/* Approve / reject shortcuts for awaiting items (leads/admin). */}
                  {canApprove && awaiting && (
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => void updateStatus(d.id, 'in_progress')}
                        aria-label={`Approve ${d.title}`}
                        title="Approve"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-status-done/15 text-status-done transition-colors duration-150 hover:bg-status-done/25"
                      >
                        <CheckIcon size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateStatus(d.id, 'cancelled')}
                        aria-label={`Reject ${d.title}`}
                        title="Reject"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/5 text-content-secondary transition-colors duration-150 hover:bg-status-blocked/15 hover:text-status-blocked"
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {/* ---- Expanded detail ---- */}
                {isExpanded && (
                  <div className="border-t border-border-subtle px-4 py-3">
                    <div className="grid gap-4 md:grid-cols-2">
                      <AssetSection
                        title="Tangibles"
                        icon={<BoxIcon size={13} />}
                        items={tangibles}
                        emptyText="No tangible assets linked."
                        onUnlink={canManageLinks ? handleUnlinkAsset : undefined}
                      />
                      <AssetSection
                        title="Intangibles"
                        icon={<KeyIcon size={13} />}
                        items={intangibles}
                        emptyText="No intangible assets linked."
                        onUnlink={canManageLinks ? handleUnlinkAsset : undefined}
                      />
                    </div>

                    {/* Link picker — only leads/admin, only with unlinked assets. */}
                    {canManageLinks && unlinkedPool.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border-subtle px-3 py-2">
                        <span className="text-[11px] text-content-secondary">
                          Link a project asset:
                        </span>
                        <select
                          value={selectedToLink[d.id] ?? ''}
                          onChange={(e) =>
                            setSelectedToLink((prev) => ({ ...prev, [d.id]: e.target.value }))
                          }
                          className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-[12px] text-content"
                          aria-label="Asset to link to deliverable"
                        >
                          <option value="">— pick an asset —</option>
                          {unlinkedPool.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.is_tangible ? '[T]' : '[I]'} {e.name} · {e.kind}
                              {e.cost != null ? ` · ${e.cost} ${e.currency}` : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!selectedToLink[d.id] || !!linking[d.id]}
                          onClick={() => void handleLinkAsset(d.id, selectedToLink[d.id]!)}
                          className="inline-flex items-center gap-1 rounded-md bg-accent-600 px-2.5 py-1 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <PlusIcon size={13} />
                          {linking[d.id] ? 'Linking…' : 'Link'}
                        </button>
                      </div>
                    )}

                    {canManageLinks &&
                      unlinkedPool.length === 0 &&
                      linked.length === 0 && (
                        <p className="mt-3 text-[11px] text-content-muted">
                          Add assets to this project&apos;s <strong>Tangibles</strong> or{' '}
                          <strong>Intangibles</strong> tab first, then link them here.
                        </p>
                      )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canPropose && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border-subtle bg-surface-raised p-3"
        >
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              role === 'team_member' ? 'Propose a deliverable…' : 'New deliverable title'
            }
            className="min-w-56 flex-1 rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-[13px] text-content placeholder:text-content-muted focus:border-accent-500 focus:outline-none"
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-44 flex-none rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-[13px] text-content focus:border-accent-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-accent-600 px-3 py-1.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon size={14} />
            {role === 'team_member' ? 'Submit for approval' : 'Add'}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * One asset section (Tangibles or Intangibles) inside a deliverable's
 * expanded detail. Renders a labelled list of chips with an optional unlink
 * affordance for leads/admin.
 */
function AssetSection({
  title,
  icon,
  items,
  emptyText,
  onUnlink,
}: {
  title: string;
  icon: React.ReactNode;
  items: Equipment[];
  emptyText: string;
  onUnlink?: (equipmentId: string) => void;
}) {
  return (
    <div>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
        <span className="text-content-secondary">{icon}</span>
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-[11px] text-content-muted">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((e) => {
            const badge =
              e.approval_status === 'pending'
                ? 'border-status-progress/25 bg-status-progress/10'
                : e.approval_status === 'rejected'
                  ? 'border-status-blocked/25 bg-status-blocked/10 opacity-60'
                  : 'border-border-subtle bg-surface';
            return (
              <span
                key={e.id}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${badge}`}
              >
                <span className="font-medium text-content">{e.name}</span>
                <span className="text-content-muted">·</span>
                <span className="text-content-secondary">{e.kind}</span>
                {e.cost != null && (
                  <>
                    <span className="text-content-muted">·</span>
                    <span className="tabular-nums text-content-secondary">
                      {e.cost} {e.currency}
                    </span>
                  </>
                )}
                {e.approval_status !== 'approved' && (
                  <span className="ml-0.5 rounded bg-status-progress/15 px-1 text-status-progress">
                    {e.approval_status}
                  </span>
                )}
                {onUnlink && (
                  <button
                    type="button"
                    onClick={() => onUnlink(e.id)}
                    className="ml-0.5 text-content-muted transition-colors duration-150 hover:text-status-blocked"
                    title={`Unlink "${e.name}" from this deliverable`}
                    aria-label={`Unlink ${e.name}`}
                  >
                    <XIcon size={12} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
