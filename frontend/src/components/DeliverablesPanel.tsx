import { useCallback, useEffect, useState } from 'react';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import type { Deliverable, DeliverableStatus } from '../types/api';

interface Props {
  projectId: string;
}

const STATUSES: DeliverableStatus[] = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];

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
 * When a dedicated `approval_status` column lands in the backend, swap the
 * `todo` heuristic for the real field — no other UI changes required.
 */
export function DeliverablesPanel({ projectId }: Props) {
  const { apiGet, apiPost, apiPatch } = useApi();
  const role = useRole();

  const canPropose = role === 'team_member' || role === 'team_lead' || role === 'admin';
  const canApprove = role === 'team_lead' || role === 'admin';

  const [rows, setRows] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    apiGet<ListResponse<Deliverable>>(`/deliverables-service?project_id=${encodeURIComponent(projectId)}`)
      .then((res) => setRows(res.data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet, projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

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
              <th scope="col" className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-4 text-gray-500">No deliverables yet.</td></tr>
            )}
            {rows.map((d) => {
              const awaiting = d.status === 'todo';
              return (
                <tr key={d.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">{d.title}</td>
                  <td className="px-3 py-2">
                    {d.status}
                    {awaiting && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        awaiting approval
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{d.due_date ?? '—'}</td>
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
                        onChange={(e) => void updateStatus(d.id, e.target.value as DeliverableStatus)}
                        className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {canPropose && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="grid grid-cols-1 gap-2 rounded border border-dashed border-gray-300 p-3 sm:grid-cols-[1fr,180px,auto]"
        >
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={role === 'team_member' ? 'Propose a deliverable…' : 'New deliverable title'}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {role === 'team_member' ? 'Submit for approval' : 'Add'}
          </button>
        </form>
      )}
    </div>
  );
}

