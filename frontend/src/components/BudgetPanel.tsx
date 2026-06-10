import { useCallback, useEffect, useState } from 'react';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import type { BudgetPlan } from '../types/api';

interface Props {
  projectId: string;
}

/**
 * Budget panel. Members can propose budget lines for a project; team leads
 * approve or remove them.
 *
 * As with deliverables, the `budget_plans` table doesn't yet carry an
 * `approval_status` column — we use `amount_consumed === '0' && amount_planned > 0`
 * with a zero `planned_at` heuristic when needed. For now the "approval"
 * action is modeled as the team-lead being the only role that can DELETE
 * (reject) entries; any role with create permission can also leave the line
 * as-is once a lead has reviewed it. Replace with a real field when the
 * backend grows one.
 */
export function BudgetPanel({ projectId }: Props) {
  const { apiGet, apiPost, apiDelete } = useApi();
  const role = useRole();

  const canPropose = role === 'team_member' || role === 'team_lead' || role === 'admin';
  const canApprove = role === 'team_lead' || role === 'admin';

  const [rows, setRows] = useState<BudgetPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    apiGet<ListResponse<BudgetPlan>>(`/budget-service?project_id=${encodeURIComponent(projectId)}`)
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
      await apiPost<BudgetPlan>('/budget-service', {
        project_id: projectId,
        category: category.trim(),
        amount_planned: amount,
        currency,
      });
      setCategory('');
      setAmount('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (id: string): Promise<void> => {
    setError(null);
    try {
      await apiDelete(`/budget-service/${id}`);
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
              <th scope="col" className="px-3 py-2">Category</th>
              <th scope="col" className="px-3 py-2">Planned</th>
              <th scope="col" className="px-3 py-2">Consumed</th>
              <th scope="col" className="px-3 py-2">Currency</th>
              {canApprove && <th scope="col" className="px-3 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={canApprove ? 5 : 4} className="px-3 py-4 text-gray-500">No budget lines yet.</td></tr>
            )}
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-gray-100">
                <td className="px-3 py-2">{b.category}</td>
                <td className="px-3 py-2">{b.amount_planned}</td>
                <td className="px-3 py-2">{b.amount_consumed ?? '0'}</td>
                <td className="px-3 py-2">{b.currency}</td>
                {canApprove && (
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void handleReject(b.id)}
                      className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canPropose && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="grid grid-cols-1 gap-2 rounded border border-dashed border-gray-300 p-3 sm:grid-cols-[1fr,140px,100px,auto]"
        >
          <input
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category (e.g. travel)"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            required
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount planned"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            required
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm uppercase"
            aria-label="Currency code"
          />
          <button
            type="submit"
            disabled={submitting || !category.trim() || !amount}
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {role === 'team_member' ? 'Submit for approval' : 'Add line'}
          </button>
        </form>
      )}
    </div>
  );
}

