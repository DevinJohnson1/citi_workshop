import { useCallback, useEffect, useState } from 'react';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import type { ApprovalStatus, Equipment, EquipmentStatus } from '../types/api';

interface Props {
  projectId: string;
  isTangible: boolean;
}

/** Kind input is free-form — no autocomplete suggestions are surfaced. */

const EQUIPMENT_STATUSES: EquipmentStatus[] = ['available', 'in_use', 'maintenance', 'retired'];

/**
 * Project-scoped tangibles / intangibles panel.
 *
 * Mirrors the global ResourcesPage equipment tab but scoped to one
 * project: it lists only equipment whose `assigned_project_id` matches,
 * lets the user **create a new** item already attached to the project,
 * **attach an existing** unassigned item, and **detach** assigned items.
 * Costed items are gated by the project's singular `budget_amount` —
 * the budget-service / equipment-service do the enforcement; this
 * component surfaces the resulting 4xx error verbatim when the gate
 * fires.
 *
 * Authorisation mirrors the equipment-service:
 * - admin / team_lead: can create (auto-approved), attach, detach,
 *   approve/reject, and (admin only) delete.
 * - team_member: can self-request (creates a *pending* item attached
 *   to the project) and withdraw their own pending request, but cannot
 *   attach existing items, approve, or detach approved ones.
 * - viewer: read-only.
 */
export function ProjectEquipmentPanel({ projectId, isTangible }: Props) {
  const { apiGet, apiPost, apiPatch, apiDelete } = useApi();
  const role = useRole();
  const canWrite = role === 'admin' || role === 'team_lead';
  const canSelfRequest = role === 'team_member';
  const canApprove = canWrite;
  const canAttach = canWrite;
  const canDetach = canWrite;
  const canDelete = role === 'admin';

  const noun = isTangible ? 'tangible' : 'intangible';
  const Noun = isTangible ? 'Tangible' : 'Intangible';

  const [assigned, setAssigned] = useState<Equipment[]>([]);
  const [available, setAvailable] = useState<Equipment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState<EquipmentStatus>('available');
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [submitting, setSubmitting] = useState(false);

  const [attachId, setAttachId] = useState('');
  const [attaching, setAttaching] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    // Three parallel reads:
    //  1. items already attached to this project — primary table.
    //  2. unassigned items of the same type — feeds the "attach" picker
    //     (only fetched when the role can actually attach).
    //  3. /kinds for the create form's datalist (merged with hard-coded
    //     common values for an empty database).
    Promise.all([
      apiGet<ListResponse<Equipment>>(
        `/equipment-service?is_tangible=${isTangible}&assigned_project_id=${encodeURIComponent(projectId)}&limit=100`,
      ),
      canAttach
        ? apiGet<ListResponse<Equipment>>(
            `/equipment-service?is_tangible=${isTangible}&approval_status=approved&limit=100`,
          ).catch(() => ({ data: [] as Equipment[], meta: { total: 0, limit: 0, offset: 0 } }))
        : Promise.resolve({ data: [] as Equipment[], meta: { total: 0, limit: 0, offset: 0 } }),
    ])
      .then(([mine, pool]) => {
        setAssigned(mine.data);
        // The "available" pool is anything approved + unassigned. The
        // backend doesn't have an "is null" filter, so we strain on the
        // client; equipment-service caps at limit=100 which is fine for
        // this view since unassigned tangibles tend to be a short list.
        setAvailable(pool.data.filter((e) => e.assigned_project_id === null));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet, isTangible, projectId, canAttach]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Create the item already attached to the project. If a cost is
      // included, the equipment-service runs the budget gate inline and
      // rejects with a 400 we surface as-is.
      const body: Record<string, unknown> = {
        name: name.trim(),
        kind: kind.trim(),
        status,
        is_tangible: isTangible,
        assigned_project_id: projectId,
      };
      if (cost.trim()) {
        body.cost = Number(cost);
        body.currency = currency.toUpperCase();
      }
      await apiPost<Equipment>('/equipment-service', body);
      setName('');
      setKind('');
      setStatus('available');
      setCost('');
      setCurrency('USD');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAttach = async (): Promise<void> => {
    if (!attachId) return;
    setAttaching(true);
    setError(null);
    try {
      // PATCH only the assignment — the equipment-service re-runs the
      // budget gate using the item's existing cost.
      await apiPatch<Equipment>(`/equipment-service/${attachId}`, {
        assigned_project_id: projectId,
      });
      setAttachId('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setAttaching(false);
    }
  };

  const handleDetach = async (id: string): Promise<void> => {
    setError(null);
    try {
      // null clears the assignment, freeing the equipment's cost back to
      // the project's remaining budget on the next read.
      await apiPatch<Equipment>(`/equipment-service/${id}`, {
        assigned_project_id: null,
      });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  const handleApproval = async (id: string, approval: ApprovalStatus): Promise<void> => {
    setError(null);
    try {
      await apiPatch<Equipment>(`/equipment-service/${id}`, { approval_status: approval });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  const handleRemove = async (id: string): Promise<void> => {
    setError(null);
    try {
      await apiDelete(`/equipment-service/${id}`);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  const canCreate = canWrite || canSelfRequest;
  const submitLabel = canSelfRequest ? 'Submit for approval' : 'Add to project';
  const actionsColShown = canApprove || canDelete || canDetach;

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        {loading && <p className="px-3 py-2 text-sm text-gray-500">Loading…</p>}
        {!loading && (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-700">
              <tr>
                <th scope="col" className="px-3 py-2">Name</th>
                <th scope="col" className="px-3 py-2">Kind</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">Approval</th>
                <th scope="col" className="px-3 py-2 text-right">Cost</th>
                {actionsColShown && <th scope="col" className="px-3 py-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {assigned.length === 0 && (
                <tr>
                  <td colSpan={actionsColShown ? 6 : 5} className="px-3 py-4 text-gray-500">
                    No {noun} resources attached to this project yet.
                  </td>
                </tr>
              )}
              {assigned.map((e) => {
                const pending = e.approval_status === 'pending';
                const rejected = e.approval_status === 'rejected';
                const badge = pending
                  ? 'bg-amber-100 text-amber-800'
                  : rejected
                    ? 'bg-red-100 text-red-700'
                    : 'bg-emerald-100 text-emerald-800';
                return (
                  <tr key={e.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">{e.name}</td>
                    <td className="px-3 py-2">{e.kind}</td>
                    <td className="px-3 py-2">{e.status}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${badge}`}>{e.approval_status}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {e.cost != null ? `${e.cost} ${e.currency}` : <span className="text-gray-400">—</span>}
                    </td>
                    {actionsColShown && (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {canApprove && pending && (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleApproval(e.id, 'approved')}
                                className="rounded bg-emerald-600 px-2 py-0.5 text-xs text-white hover:bg-emerald-700"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleApproval(e.id, 'rejected')}
                                className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {canDetach && (
                            <button
                              type="button"
                              onClick={() => void handleDetach(e.id)}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                              title="Remove this item's assignment to the project (the item itself is kept)"
                            >
                              Detach
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => void handleRemove(e.id)}
                              className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
                              title="Permanently delete this item from the catalog"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Attach-existing picker. Only leads/admin see this; team members
          must self-request a brand-new item via the create form below. */}
      {canAttach && available.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          <span className="text-gray-700">Attach an existing {noun} already in the catalog:</span>
          <select
            value={attachId}
            onChange={(e) => setAttachId(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            aria-label={`Existing ${noun} to attach`}
          >
            <option value="">— pick one —</option>
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} {e.cost != null ? `(${e.cost} ${e.currency})` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleAttach()}
            disabled={!attachId || attaching}
            className="rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {attaching ? 'Attaching…' : 'Attach'}
          </button>
        </div>
      )}

      {/* Create-new form. Submission auto-assigns the item to this project. */}
      {canCreate && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className={`flex flex-wrap items-start gap-2 rounded border border-dashed p-3 ${
            canSelfRequest ? 'border-amber-300 bg-amber-50' : 'border-gray-300'
          }`}
        >
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              canSelfRequest
                ? `Propose a ${noun} for this project (e.g. ${isTangible ? 'MacBook Pro 14' : 'Figma seat'})…`
                : `${Noun} name (e.g. ${isTangible ? 'MacBook Pro 14' : 'Figma seat'})`
            }
            className="min-w-48 flex-[2_1_14rem] rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            required
            maxLength={80}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder={`kind (free-form — e.g. ${isTangible ? 'laptop, forklift' : 'software_license, certification'})`}
            className="min-w-40 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
            aria-label={`${Noun} kind`}
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as EquipmentStatus)}
            className="min-w-32 flex-none rounded border border-gray-300 px-2 py-1.5 text-sm"
            aria-label={`${Noun} status`}
          >
            {EQUIPMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            type="number"
            required
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="Cost"
            className="w-28 flex-none rounded border border-gray-300 px-2 py-1.5 text-sm tabular-nums"
            aria-label="Cost"
            title="Required when creating from a project — this is what charges against the budget"
          />
          <input
            type="text"
            required
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="USD"
            className="w-20 flex-none rounded border border-gray-300 px-2 py-1.5 text-sm uppercase"
            aria-label="Currency code"
            title="Three-letter currency code (USD, EUR, …)"
          />
          <button
            type="submit"
            disabled={submitting || !name.trim() || !kind.trim() || !cost.trim()}
            className={`w-full rounded px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${
              canSelfRequest ? 'bg-amber-600 hover:bg-amber-700' : 'bg-brand-600 hover:bg-brand-700'
            }`}
          >
            {submitLabel}
          </button>
        </form>
      )}
    </div>
  );
}







