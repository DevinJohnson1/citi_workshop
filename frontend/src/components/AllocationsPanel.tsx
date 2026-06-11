import { useCallback, useEffect, useState } from 'react';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import { useCurrentUser } from '../auth/useCurrentUser';
import type { Allocation, ApprovalStatus, User } from '../types/api';
import {
  HOURLY_RATE_USD,
  HOURS_PER_WEEK,
  DAILY_RATE,
  computeLaborCost,
  getConcurrencyStats,
  formatUsd,
} from '../utils/laborCost';
import { overworkSuffix } from './OverworkBadge';
import { approvalLabel, roleLabel } from '../utils/labels';
import { SortableHeader } from './ui/SortableHeader';
import { useSortableTable } from '../utils/useSortableTable';

/**
 * Props for {@link AllocationsPanel}.
 */
interface Props {
  /** The project whose allocations are displayed and managed. */
  projectId: string;
  /** Owner of the project — non-owning leads can only self-request. */
  ownerId: string;
  /**
   * Full set of project lead ids (owner + co-leads). Any user in this list
   * with the `team_lead` role gets the same write authority as the owner —
   * mirrors backend `_lib/projects.is_project_lead`. Optional for backwards
   * compatibility with payloads predating the `project_leads` table; when
   * omitted, falls back to `[ownerId]`.
   */
  leadIds?: string[];
}

/**
 * Allocations panel — the "assign members" surface for team leads, plus the
 * self-request surface for team members.
 *
 *   - team_lead / admin: pick a user, choose a date range, post a row
 *     (auto-approved); approve / reject any pending requests on the project.
 *   - team_member: submit a self-request (date range only — backend
 *     forces user_id = themselves and approval_status = pending).
 *   - viewer / others: read-only listing.
 *
 * The picker is sourced from `/resources-service` (allocatable users only).
 * Migration 003 backfilled `is_allocatable=true` for every team_lead and
 * team_member so this dropdown is populated for the first time.
 *
 * Labour cost uses a $100/h × 40 h/week baseline (~$571/day).  The cost is
 * split **day by day**: on any day where the person has N active allocations
 * across all projects, this project is charged 1/N of the daily rate for that
 * day.  Days worked exclusively on this project carry the full daily rate.
 */
export function AllocationsPanel({ projectId, ownerId, leadIds }: Props) {
  const { apiGet, apiPost, apiPatch, apiDelete } = useApi();
  const role = useRole();
  const me = useCurrentUser();
  const isAdmin = role === 'admin';
  // "Owning lead" = any project lead (canonical owner or co-lead). Co-leads
  // get identical write authority — see backend _lib/projects.
  const effectiveLeadIds = leadIds && leadIds.length > 0 ? leadIds : [ownerId];
  const isOwningLead = role === 'team_lead' && me !== null && effectiveLeadIds.includes(me.id);
  // Only admin or the owning lead may allocate *other people*. Non-owning
  // leads (and team members) can self-request — they may join the project
  // themselves as a pending allocation that the owning lead must approve.
  const canAssign = isAdmin || isOwningLead;
  const canApprove = canAssign;

  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Anyone who isn't an admin/owning lead and who doesn't already have an
  // allocation on the project may submit a self-request. Once they have any
  // allocation here (pending, approved, or even rejected) the form hides —
  // they can withdraw a pending row and try again instead of stacking
  // duplicate requests.
  const hasOwnAllocation =
    me !== null && allocations.some((a) => a.user_id === me.id);
  const canSelfRequest =
    !canAssign &&
    !hasOwnAllocation &&
    (role === 'team_member' || role === 'team_lead');

  /**
   * Map of user_id → all approved allocations for that user across every
   * project.  Used for per-day concurrency calculations.
   */
  const [userAllAllocations, setUserAllAllocations] = useState<Record<string, Allocation[]>>({});

  const [userId, setUserId] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<ListResponse<Allocation>>(`/allocations-service?project_id=${encodeURIComponent(projectId)}&limit=100`),
      apiGet<ListResponse<User>>('/resources-service'),
    ])
      .then(([allocs, us]) => {
        setAllocations(allocs.data);
        setUsers(us.data);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet, projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * After the allocation list is populated, fetch every approved allocation
   * for each unique user across ALL projects so per-day concurrency can be
   * computed accurately.  Failures are silent — cost will fall back to the
   * full daily rate (treating the person as solely on this project).
   */
  useEffect(() => {
    const uniqueUserIds = [...new Set(allocations.map((a) => a.user_id))];
    if (uniqueUserIds.length === 0) {
      setUserAllAllocations({});
      return;
    }

    void Promise.all(
      uniqueUserIds.map((uid) =>
        apiGet<ListResponse<Allocation>>(
          `/allocations-service?user_id=${encodeURIComponent(uid)}&approval_status=approved&limit=100`,
        ).then((resp): [string, Allocation[]] => [uid, resp.data]),
      ),
    )
      .then((entries) => setUserAllAllocations(Object.fromEntries(entries)))
      .catch(() => {
        // Fall back to the allocation itself as the only one for this user.
      });
  }, [allocations, apiGet]);

  const userById = (id: string): User | undefined => users.find((u) => u.id === id);

  const handleAssign = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Team members omit user_id (backend forces self); leads/admins pick.
      // Capacity is described in free text via `role_description` — the old
      // numeric `percent` column was retired by migration 005.
      const body: Record<string, unknown> = {
        project_id: projectId,
        role_description: roleDescription.trim(),
        start_date: startDate,
        end_date: endDate,
      };
      if (canAssign) body.user_id = userId;
      await apiPost<Allocation>('/allocations-service', body);
      setUserId('');
      setRoleDescription('');
      setStartDate('');
      setEndDate('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproval = async (id: string, status: ApprovalStatus): Promise<void> => {
    setError(null);
    try {
      await apiPatch<Allocation>(`/allocations-service/${id}`, { approval_status: status });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  const handleRemove = async (id: string): Promise<void> => {
    setError(null);
    try {
      await apiDelete(`/allocations-service/${id}`);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  const isMine = (a: Allocation): boolean => me !== null && a.user_id === me.id;

  /**
   * Sum labour costs for approved allocations only.  Pending/rejected rows
   * are included in the per-row display but excluded from the project total
   * because they have not yet been committed.
   */
  const totalApprovedLaborCost = allocations
    .filter((a) => a.approval_status === 'approved')
    .reduce((sum, a) => {
      const allAllocs = userAllAllocations[a.user_id] ?? [a];
      return sum + computeLaborCost(a, allAllocs);
    }, 0);

  // Pre-compute labor cost per allocation so the sort accessor stays cheap
  // and we can reuse the value when rendering the cell.
  const laborCostById: Record<string, number> = {};
  for (const a of allocations) {
    const allAllocs = userAllAllocations[a.user_id] ?? [a];
    laborCostById[a.id] = computeLaborCost(a, allAllocs);
  }
  const userLabel = (id: string): string => {
    const u = userById(id);
    return u ? (u.full_name || u.email) : id;
  };

  const { sorted, sort, setSort } = useSortableTable(allocations, {
    member: (a) => userLabel(a.user_id),
    role:   (a) => a.role_description ?? '',
    start:  (a) => a.start_date,
    end:    (a) => a.end_date,
    status: (a) => a.approval_status,
    cost:   (a) => laborCostById[a.id] ?? 0,
  }, { key: 'member', dir: 'asc' });

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-ember-500">{error}</p>}
      {loading ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : (
        // Horizontal scroll wrapper so the rightmost columns (Status / Labor
        // cost) don't break out of the card on narrow viewports — matches
        // BudgetPanel / DeliverablesPanel / ProjectEquipmentPanel.
        <div className="overflow-x-auto rounded border border-line bg-surface">
          <table className="min-w-full text-sm">
          <thead className="bg-surface-2 text-left text-ink-700">
            <tr>
              <SortableHeader sortKey="member" sort={sort} setSort={setSort}>Member</SortableHeader>
              <SortableHeader sortKey="role"   sort={sort} setSort={setSort}>Role on project</SortableHeader>
              <SortableHeader sortKey="start"  sort={sort} setSort={setSort}>Start</SortableHeader>
              <SortableHeader sortKey="end"    sort={sort} setSort={setSort}>End</SortableHeader>
              <SortableHeader sortKey="status" sort={sort} setSort={setSort}>Status</SortableHeader>
              <SortableHeader sortKey="cost"   sort={sort} setSort={setSort} align="right"
                title={`~${formatUsd(DAILY_RATE)}/day ($${HOURLY_RATE_USD}/h × ${HOURS_PER_WEEK} h/week ÷ 7), split by concurrent active projects per day`}
              >
                Labor Cost
              </SortableHeader>
              <th scope="col" className="px-4 py-2.5 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-5 text-ink-400">No allocations yet.</td></tr>
            )}
            {sorted.map((a) => {
              const user = userById(a.user_id);
              const pending = a.approval_status === 'pending';
              const rejected = a.approval_status === 'rejected';
              const badgeClass = pending
                ? 'bg-amber-100 text-amber-700'
                : rejected
                  ? 'bg-ember-100 text-ember-700'
                  : 'bg-jade-100 text-jade-700';

              const allAllocs = userAllAllocations[a.user_id] ?? [a];
              const laborCost = laborCostById[a.id] ?? 0;
              const { min, max } = getConcurrencyStats(a, allAllocs);
              const concurrencyNote =
                min === max
                  ? `${min} concurrent project${min === 1 ? '' : 's'} every day`
                  : `${min}–${max} concurrent projects depending on the day`;
              const costNote = `${formatUsd(DAILY_RATE)}/day ÷ concurrent projects — ${concurrencyNote}`;

              return (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-4 py-2.5">{user ? (user.full_name || user.email) : a.user_id}</td>
                  <td className="px-4 py-2.5 text-ink-700">
                    {a.role_description || <span className="text-ink-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5">{a.start_date}</td>
                  <td className="px-4 py-2.5">{a.end_date}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${badgeClass}`}>
                      {approvalLabel(a.approval_status)}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums ${pending || rejected ? 'text-ink-300' : 'text-ink-900'}`}
                    title={costNote}
                  >
                    {formatUsd(laborCost)}
                    {(pending || rejected) && (
                      <span className="ml-1 text-xs text-ink-300">({approvalLabel(a.approval_status).toLowerCase()})</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {canApprove && pending && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleApproval(a.id, 'approved')}
                            className="rounded bg-jade-500 px-2 py-0.5 text-xs text-white hover:bg-jade-700"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleApproval(a.id, 'rejected')}
                            className="rounded border border-line-strong px-2 py-0.5 text-xs hover:bg-surface-2"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {(canAssign || (canSelfRequest && isMine(a) && pending)) && (
                        <button
                          type="button"
                          onClick={() => void handleRemove(a.id)}
                          className="rounded border border-line-strong px-2 py-0.5 text-xs hover:bg-surface-2"
                        >
                          {canAssign ? 'Remove' : 'Withdraw'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {allocations.length > 0 && (
            <tfoot className="border-t-2 border-line-strong bg-surface-2 font-medium">
              <tr>
                <td colSpan={5} className="px-4 py-2.5 text-right text-ink-500">
                  Total approved labor cost
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-900">
                  {formatUsd(totalApprovedLaborCost)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      )}

      {canAssign && (
        <form
          onSubmit={(e) => void handleAssign(e)}
          className="grid grid-cols-1 gap-2 rounded border border-dashed border-line-strong p-3 sm:grid-cols-[1fr,2fr,160px,160px,auto]"
        >
          <select
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="rounded border border-line-strong px-2 py-1.5 text-sm"
          >
            <option value="">— pick a member —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.email}{u.role ? ` (${roleLabel(u.role)})` : ''}{overworkSuffix(u)}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={roleDescription}
            onChange={(e) => setRoleDescription(e.target.value)}
            placeholder="Role on project (e.g. Backend lead, QA reviewer)"
            maxLength={500}
            className="rounded border border-line-strong px-2 py-1.5 text-sm"
            aria-label="Role on project"
          />
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded border border-line-strong px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded border border-line-strong px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={submitting || !userId}
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Assign
          </button>
        </form>
      )}

      {canSelfRequest && (
        <form
          onSubmit={(e) => void handleAssign(e)}
          className="grid grid-cols-1 gap-2 rounded border border-dashed border-amber-100 bg-amber-50 p-3 sm:grid-cols-[2fr,160px,160px,auto]"
        >
          <input
            type="text"
            value={roleDescription}
            onChange={(e) => setRoleDescription(e.target.value)}
            placeholder="Role you'd play (e.g. Frontend contributor)"
            maxLength={500}
            className="rounded border border-line-strong px-2 py-1.5 text-sm"
            aria-label="Role on project"
          />
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded border border-line-strong px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded border border-line-strong px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={submitting || !startDate || !endDate}
            className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            title="Self-request — a team lead must approve before it becomes active"
          >
            Request to join
          </button>
        </form>
      )}
    </div>
  );
}
