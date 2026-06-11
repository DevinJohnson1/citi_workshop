import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import type { Allocation, BudgetCharge, ProjectBudget, User } from '../types/api';
import { approvalLabel } from '../utils/labels';
import { SortableHeader } from './ui/SortableHeader';
import { useSortableTable } from '../utils/useSortableTable';
import {
  DAILY_RATE,
  HOURLY_RATE_USD,
  HOURS_PER_WEEK,
  computeLaborCost,
  getConcurrencyStats,
  formatUsd,
} from '../utils/laborCost';

interface Props {
  projectId: string;
}

/**
 * Project budget panel.
 *
 * Data model: each project carries a singular `budget_amount` /
 * `budget_currency` on the `projects` row (no separate plan/entry tables).
 * Equipment (tangibles / intangibles) assigned to the project draws against
 * the ceiling.  Labour cost is computed client-side from approved allocations:
 * $100/h × 40 h/week, split evenly across all projects the person is on,
 * scaled by the allocation's duration in weeks.
 *
 * Authorisation: budget-service accepts writes from admin or the owning
 * team_lead; we mirror that on the client to hide the form for everyone
 * else. The server is still the authority — see
 * `backend/budget-service/function.py::_require_owner_or_admin`.
 */
export function BudgetPanel({ projectId }: Props) {
  const { apiGet, apiPut } = useApi();
  const role = useRole();
  const canEdit = role === 'admin' || role === 'team_lead';

  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [amountDraft, setAmountDraft] = useState('');
  const [currencyDraft, setCurrencyDraft] = useState('USD');
  const [submitting, setSubmitting] = useState(false);

  /**
   * Approved allocations for this project, used to compute labour costs.
   * Fetched in parallel with the budget data.
   */
  const [allocations, setAllocations] = useState<Allocation[]>([]);

  /**
   * Map of user_id → all approved allocations for that user across every
   * project.  Used for per-day concurrency calculations.
   */
  const [userAllAllocations, setUserAllAllocations] = useState<Record<string, Allocation[]>>({});

  /** Name lookup from resources-service (full_name / email). */
  const [users, setUsers] = useState<User[]>([]);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<ProjectBudget>(`/budget-service?project_id=${encodeURIComponent(projectId)}`),
      apiGet<ListResponse<Allocation>>(
        `/allocations-service?project_id=${encodeURIComponent(projectId)}&approval_status=approved&limit=100`,
      ),
      apiGet<ListResponse<User>>('/resources-service'),
    ])
      .then(([res, allocs, us]) => {
        setBudget(res);
        setAmountDraft(res.budget_amount ?? '');
        setCurrencyDraft(res.budget_currency || 'USD');
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
   * After the approved allocations are loaded, fetch every approved allocation
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

  const handleSave = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Empty input → null clears the ceiling (gate disabled). Non-empty →
      // upsert. The server rejects values below already-committed costs.
      const next = await apiPut<ProjectBudget>('/budget-service', {
        project_id: projectId,
        budget_amount: amountDraft.trim() === '' ? null : amountDraft,
        budget_currency: currencyDraft.toUpperCase(),
      });
      setBudget(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Sort hook is declared above the early returns so the hook order stays
  // stable across renders — calling useSortableTable after a conditional
  // return would violate React's rules of hooks and surface as "Rendered
  // more hooks than during the previous render" once the data loads.
  // Accessors close over `allocations` / `users` / `userAllAllocations`,
  // all of which are always defined (empty arrays before the fetch).
  const laborSort = useSortableTable(allocations, {
    member: (a) => {
      const u = users.find((x) => x.id === a.user_id);
      return u ? (u.full_name || u.email) : a.user_id;
    },
    role:  (a) => a.role_description ?? '',
    start: (a) => a.start_date,
    end:   (a) => a.end_date,
    cost:  (a) => {
      const allAllocs = userAllAllocations[a.user_id] ?? [a];
      return computeLaborCost(a, allAllocs);
    },
  }, { key: 'member', dir: 'asc' });

  if (loading) return <p className="text-sm text-ink-400">Loading…</p>;
  if (error) return <p className="text-sm text-ember-500">{error}</p>;
  if (!budget) return null;

  const ceiling = budget.budget_amount;
  const equipmentConsumed = Number(budget.amount_consumed);

  /** Total approved labour cost across all allocations on this project. */
  const laborTotal = allocations.reduce((sum, a) => {
    const allAllocs = userAllAllocations[a.user_id] ?? [a];
    return sum + computeLaborCost(a, allAllocs);
  }, 0);

  /** Combined equipment + labour spend against the budget. */
  const totalConsumed = equipmentConsumed + laborTotal;
  const totalRemaining = ceiling != null ? Number(ceiling) - totalConsumed : null;

  const userById = (id: string): User | undefined => users.find((u) => u.id === id);

  // Pre-compute labour cost per allocation so the sort accessor is cheap.
  const laborCostById: Record<string, number> = {};
  for (const a of allocations) {
    const allAllocs = userAllAllocations[a.user_id] ?? [a];
    laborCostById[a.id] = computeLaborCost(a, allAllocs);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Budget ceiling"
          value={ceiling != null ? `${ceiling} ${budget.budget_currency}` : '— not set —'}
          tone={ceiling != null ? 'neutral' : 'muted'}
        />
        <SummaryCard
          label="Equipment consumed"
          value={`${equipmentConsumed.toFixed(2)} ${budget.budget_currency}`}
          tone="neutral"
        />
        <SummaryCard
          label="Labor (people)"
          value={formatUsd(laborTotal)}
          hint={`~${formatUsd(DAILY_RATE)}/day ($${HOURLY_RATE_USD}/h × ${HOURS_PER_WEEK} h/week ÷ 7), split by concurrent active projects per day`}
          tone="neutral"
        />
        <SummaryCard
          label="Remaining"
          value={
            totalRemaining != null
              ? `${totalRemaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${budget.budget_currency}`
              : '∞'
          }
          hint={
            totalRemaining != null
              ? `Ceiling − (equipment ${equipmentConsumed.toFixed(2)} + labor ${formatUsd(laborTotal)})`
              : undefined
          }
          tone={
            totalRemaining != null && totalRemaining < 0
              ? 'danger'
              : totalRemaining != null && totalRemaining === 0
                ? 'warn'
                : 'good'
          }
        />
      </div>

      {/* Equipment charges — unchanged from before */}
      {/* Charges are split into two distinct tables (tangibles, intangibles)
          so the user can read each category's draw against the budget without
          interleaving. Both are sourced from the same `budget.charges` array
          (server-side ordered by is_tangible DESC, then name) — we just
          partition on the client to avoid a second request. */}
      <ChargesTable
        title="Tangibles"
        emptyHint="No tangible resources are charged to this project yet."
        rows={budget.charges.filter((c) => c.is_tangible)}
      />
      <ChargesTable
        title="Intangibles"
        emptyHint="No intangible resources (licenses, subscriptions, …) are charged to this project yet."
        rows={budget.charges.filter((c) => !c.is_tangible)}
      />

      {/* Labor cost breakdown per person */}
      <section className="space-y-1">
        <header className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink-700">People (labor)</h3>
          {allocations.length > 0 && (
            <span className="text-xs text-ink-400 tabular-nums">
              Total: {formatUsd(laborTotal)}
            </span>
          )}
        </header>
        <div className="overflow-x-auto rounded border border-line bg-surface">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-2 text-left text-ink-700">
              <tr>
                <SortableHeader sortKey="member" sort={laborSort.sort} setSort={laborSort.setSort}>Member</SortableHeader>
                <SortableHeader sortKey="role"   sort={laborSort.sort} setSort={laborSort.setSort}>Role on project</SortableHeader>
                <SortableHeader sortKey="start"  sort={laborSort.sort} setSort={laborSort.setSort}>Start</SortableHeader>
                <SortableHeader sortKey="end"    sort={laborSort.sort} setSort={laborSort.setSort}>End</SortableHeader>
                <SortableHeader sortKey="cost"   sort={laborSort.sort} setSort={laborSort.setSort} align="right"
                  title={`~${formatUsd(DAILY_RATE)}/day ($${HOURLY_RATE_USD}/h × ${HOURS_PER_WEEK} h/week ÷ 7), split by concurrent active projects per day`}
                >
                  Labor Cost
                </SortableHeader>
              </tr>
            </thead>
            <tbody>
              {laborSort.sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-ink-400">
                    No approved allocations — assign team members in the Allocations tab.
                  </td>
                </tr>
              )}
              {laborSort.sorted.map((a) => {
                const user = userById(a.user_id);
                const allAllocs = userAllAllocations[a.user_id] ?? [a];
                const cost = laborCostById[a.id] ?? 0;
                const { min, max } = getConcurrencyStats(a, allAllocs);
                const concurrencyNote =
                  min === max
                    ? `${min} concurrent project${min === 1 ? '' : 's'} every day`
                    : `${min}–${max} concurrent projects depending on the day`;
                const costNote = `${formatUsd(DAILY_RATE)}/day ÷ concurrent projects — ${concurrencyNote}`;
                return (
                  <tr key={a.id} className="border-t border-line">
                    <td className="px-4 py-2.5">
                      {user ? (user.full_name || user.email) : a.user_id}
                    </td>
                    <td className="px-4 py-2.5 text-ink-700">
                      {a.role_description || <span className="text-ink-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5">{a.start_date}</td>
                    <td className="px-4 py-2.5">{a.end_date}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" title={costNote}>
                      {formatUsd(cost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {allocations.length > 0 && (
              <tfoot className="border-t-2 border-line-strong bg-surface-2 font-medium">
                <tr>
                  <td colSpan={4} className="px-4 py-2.5 text-right text-ink-500">
                    Total labor
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-900">
                    {formatUsd(laborTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {budget.charges.length === 0 && allocations.length === 0 && (
        <p className="rounded border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700">
          Add tangibles or intangibles from this project's <strong>Tangibles</strong> or{' '}
          <strong>Intangibles</strong> tab — each item with a recorded cost is drawn
          against this budget on assignment. Assign team members in the{' '}
          <strong>Allocations</strong> tab to include their labour cost here.{' '}
          <Link to="/resources" className="font-medium underline">
            Open the global resource catalog
          </Link>{' '}
          to see what already exists organisation-wide.
        </p>
      )}

      {canEdit && (
        <form
          onSubmit={(e) => void handleSave(e)}
          className="flex flex-wrap items-start gap-2 rounded border border-dashed border-line-strong p-3"
        >
          <input
            type="number"
            min={0}
            step="0.01"
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            placeholder="Budget ceiling (blank = no limit)"
            className="min-w-48 flex-1 rounded border border-line-strong px-2 py-1.5 text-sm tabular-nums"
            aria-label="Budget ceiling"
          />
          <input
            type="text"
            maxLength={3}
            value={currencyDraft}
            onChange={(e) => setCurrencyDraft(e.target.value)}
            placeholder="USD"
            className="w-20 flex-none rounded border border-line-strong px-2 py-1.5 text-sm uppercase"
            aria-label="Currency code"
            title="Three-letter currency code (USD, EUR, …)"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {submitting ? 'Saving…' : 'Save budget'}
          </button>
        </form>
      )}
    </div>
  );
}

type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'muted';

/**
 * Small KPI card used in the summary row above; kept local since it has no
 * other consumer.
 */
function SummaryCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: Tone;
  hint?: string;
}) {
  const toneClass: Record<Tone, string> = {
    neutral: 'border-line bg-surface',
    good: 'border-jade-100 bg-jade-50',
    warn: 'border-amber-100 bg-amber-50',
    danger: 'border-ember-100 bg-ember-50',
    muted: 'border-line bg-surface-2 text-ink-400',
  };
  return (
    <div className={`rounded border px-3 py-2 ${toneClass[tone]}`} title={hint}>
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-ink-300">{hint}</div>}
    </div>
  );
}

/**
 * Reusable table for one category of equipment charges. Rendered twice —
 * once for tangibles, once for intangibles — so each category gets its own
 * header and totals row instead of being interleaved in a single table.
 */
function ChargesTable({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: BudgetCharge[];
  emptyHint: string;
}) {
  const subtotal = rows.reduce(
    (acc, c) => acc + (c.cost != null ? Number(c.cost) : 0),
    0,
  );
  // Currency for the subtotal: use the first row's currency. Mixed-currency
  // projects aren't supported by the budget gate either, so this matches the
  // backend's implicit assumption (project.budget_currency wins).
  const currency = rows[0]?.currency ?? '';
  const { sorted, sort, setSort } = useSortableTable(rows, {
    name:     (c) => c.name,
    kind:     (c) => c.kind,
    approval: (c) => c.approval_status,
    cost:     (c) => c.cost ?? -1,
  }, { key: 'name', dir: 'asc' });
  return (
    <section className="space-y-1">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink-700">{title}</h3>
        {rows.length > 0 && (
          <span className="text-xs text-ink-400 tabular-nums">
            Subtotal: {subtotal.toFixed(2)} {currency}
          </span>
        )}
      </header>
      <div className="overflow-x-auto rounded border border-line bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-2 text-left text-ink-700">
            <tr>
              <SortableHeader sortKey="name"     sort={sort} setSort={setSort}>Item</SortableHeader>
              <SortableHeader sortKey="kind"     sort={sort} setSort={setSort}>Kind</SortableHeader>
              <SortableHeader sortKey="approval" sort={sort} setSort={setSort}>Approval</SortableHeader>
              <SortableHeader sortKey="cost"     sort={sort} setSort={setSort} align="right">Cost</SortableHeader>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-ink-400">
                  {emptyHint}
                </td>
              </tr>
            )}
            {sorted.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="px-4 py-2.5">{c.name}</td>
                <td className="px-4 py-2.5">{c.kind}</td>
                <td className="px-4 py-2.5">{approvalLabel(c.approval_status)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {c.cost != null ? `${c.cost} ${c.currency}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}


