import { useCallback, useEffect, useState } from 'react';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import { useCurrentUser } from '../auth/useCurrentUser';
import type { Allocation, ApprovalStatus, User } from '../types/api';

interface Props {
  projectId: string;
}

/**
 * Allocations panel — the "assign members" surface for team leads, plus the
 * self-request surface for team members.
 *
 *   - team_lead / admin: pick a user, choose a % + date range, post a row
 *     (auto-approved); approve / reject any pending requests on the project.
 *   - team_member: submit a self-request (% + date range only — backend
 *     forces user_id = themselves and approval_status = pending).
 *   - viewer / others: read-only listing.
 *
 * The picker is sourced from `/resources-service` (allocatable users only).
 * Migration 003 backfilled `is_allocatable=true` for every team_lead and
 * team_member so this dropdown is populated for the first time.
 */
export function AllocationsPanel({ projectId }: Props) {
  const { apiGet, apiPost, apiPatch, apiDelete } = useApi();
  const role = useRole();
  const me = useCurrentUser();
  const canAssign = role === 'team_lead' || role === 'admin';
  const canApprove = canAssign;
  const canSelfRequest = role === 'team_member';

  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState('');
  const [percent, setPercent] = useState(50);
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

  const userById = (id: string): User | undefined => users.find((u) => u.id === id);

  const handleAssign = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Team members omit user_id (backend forces self); leads/admins pick.
      const body: Record<string, unknown> = {
        project_id: projectId,
        percent,
        start_date: startDate,
        end_date: endDate,
      };
      if (canAssign) body.user_id = userId;
      await apiPost<Allocation>('/allocations-service', body);
      setUserId('');
      setPercent(50);
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

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-700">
            <tr>
              <th scope="col" className="px-3 py-2">Member</th>
              <th scope="col" className="px-3 py-2">%</th>
              <th scope="col" className="px-3 py-2">Start</th>
              <th scope="col" className="px-3 py-2">End</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {allocations.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-gray-500">No allocations yet.</td></tr>
            )}
            {allocations.map((a) => {
              const user = userById(a.user_id);
              const pending = a.approval_status === 'pending';
              const rejected = a.approval_status === 'rejected';
              const badgeClass = pending
                ? 'bg-amber-100 text-amber-800'
                : rejected
                  ? 'bg-red-100 text-red-700'
                  : 'bg-emerald-100 text-emerald-800';
              return (
                <tr key={a.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">{user ? (user.full_name || user.email) : a.user_id}</td>
                  <td className="px-3 py-2">{a.percent}%</td>
                  <td className="px-3 py-2">{a.start_date}</td>
                  <td className="px-3 py-2">{a.end_date}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${badgeClass}`}>
                      {a.approval_status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {canApprove && pending && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleApproval(a.id, 'approved')}
                            className="rounded bg-emerald-600 px-2 py-0.5 text-xs text-white hover:bg-emerald-700"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleApproval(a.id, 'rejected')}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {(canAssign || (canSelfRequest && isMine(a) && pending)) && (
                        <button
                          type="button"
                          onClick={() => void handleRemove(a.id)}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
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
        </table>
      )}

      {canAssign && (
        <form
          onSubmit={(e) => void handleAssign(e)}
          className="grid grid-cols-1 gap-2 rounded border border-dashed border-gray-300 p-3 sm:grid-cols-[1fr,90px,160px,160px,auto]"
        >
          <select
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">— pick a member —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.email}{u.role ? ` (${u.role})` : ''}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={100}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            aria-label="Percent allocation"
          />
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
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
          className="grid grid-cols-1 gap-2 rounded border border-dashed border-amber-300 bg-amber-50 p-3 sm:grid-cols-[90px,160px,160px,auto]"
        >
          <input
            type="number"
            min={1}
            max={100}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            aria-label="Percent allocation"
          />
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
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

