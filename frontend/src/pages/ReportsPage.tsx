import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import type { Allocation, Project, User } from '../types/api';
import { Card } from '../components/ui/Card';
import { KpiTile } from '../components/ui/KpiTile';
import { BudgetBar } from '../components/ui/BudgetBar';
import { ProgressBar } from '../components/ui/ProgressBar';
import { StatusBadge } from '../components/ui/StatusBadge';
import { computeLaborCost } from '../utils/laborCost';
import { SortableHeader } from '../components/ui/SortableHeader';
import { useSortableTable } from '../utils/useSortableTable';

/* ============================================================================
   Backend response shapes — mirror reports-service/function.py.
   ========================================================================== */

interface AtRiskRow {
  id: string;
  name: string;
  status: string;
  target_end_date: string | null;
  owner_id: string;
  outdated_count: number;
}

interface OverAllocatedRow {
  user_id: string;
  email: string;
  full_name: string;
  peak_overlap: number;
}

interface OverAssignedRow {
  user_id: string;
  email: string;
  full_name: string;
  active_project_count: number;
  active_deliverable_count: number;
  exceeds_project_threshold: boolean;
  exceeds_deliverable_threshold: boolean;
}

interface OverAssignedResponse {
  data: OverAssignedRow[];
  meta: { project_threshold: number; deliverable_threshold: number };
}

interface BudgetRow {
  project_id: string;
  name: string;
  /** Comes back as decimal-formatted strings — preserve precision. */
  planned: string;
  consumed: string;
  currency: string;
}

interface AllocByUserRow {
  user_id: string;
  email: string;
  full_name: string;
  allocation_count: number;
}

interface CompletionRow {
  project_id: string;
  total: number;
  completed: number;
  percent_complete: number;
}

interface ChainRow {
  id: string;
  title: string;
  depends_on: string | null;
  depth: number;
}

/* ============================================================================
   Helpers
   ========================================================================== */

const formatMoney = (n: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n).toLocaleString()} ${currency}`;
  }
};

const num = (s: string | number | null | undefined): number => {
  if (s == null) return 0;
  const n = typeof s === 'string' ? parseFloat(s) : s;
  return Number.isFinite(n) ? n : 0;
};

/* ============================================================================
   Reports page — every portfolio aggregate the backend exposes, in one canvas.
   ========================================================================== */

/**
 * Reports — a single console that surfaces every aggregate the
 * `reports-service` Lambda exposes. The page is organised around the work
 * a portfolio manager actually does: spot at-risk projects, watch the
 * spend curve, find people who are over-loaded, and drill into a specific
 * project for completion or dependency detail.
 *
 * Structure (top → bottom):
 *  1. Headline KPI strip — risk, overload, overlap, portfolio budget.
 *  2. Projects at risk — schedule slips
 *  3. Budget vs planned across the portfolio — spend
 *  4. Workload — over-assigned + over-allocated users
 *  5. Per-project tools — completion gauge, dependency chain,
 *     allocation-by-user lookup.
 *
 * All API contracts and route shapes are preserved verbatim. The page
 * fires GETs only — no mutations, no new endpoints invented. Viewer-role
 * users see the full page; the project / user pickers degrade gracefully
 * (no link-outs that would be blocked by `ProtectedRoute`).
 */
export function ReportsPage() {
  const { apiGet } = useApi();
  const role = useRole();
  const canDeepLink = role === 'team_lead' || role === 'team_member';

  // ---- aggregate fetches (one-shot on mount) -----------------------------

  const [atRisk, setAtRisk]                 = useState<AtRiskRow[] | null>(null);
  const [overAlloc, setOverAlloc]           = useState<OverAllocatedRow[] | null>(null);
  const [overAssigned, setOverAssigned]     = useState<OverAssignedResponse | null>(null);
  const [budgetRows, setBudgetRows]         = useState<BudgetRow[] | null>(null);
  /**
   * Every approved allocation in the portfolio. Used to fold labour cost
   * into the budget-vs-planned rollup so the Reports page agrees with
   * each project's own Budget tab (which adds equipment + labour against
   * the ceiling — see BudgetPanel). Without this, the Reports `consumed`
   * column counted equipment only and silently under-reported spend.
   */
  const [allAllocs, setAllAllocs]           = useState<Allocation[] | null>(null);
  const [errors, setErrors]                 = useState<Record<string, string>>({});

  // Catalogue data powering the per-project / per-user pickers.
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers]       = useState<User[]>([]);

  useEffect(() => {
    const track = (key: string) => (err: Error) =>
      setErrors((prev) => ({ ...prev, [key]: err.message }));

    apiGet<{ data: AtRiskRow[] }>('/reports-service/at-risk')
      .then((r) => setAtRisk(r.data)).catch(track('at-risk'));
    apiGet<{ data: OverAllocatedRow[] }>('/reports-service/over-allocated')
      .then((r) => setOverAlloc(r.data)).catch(track('over-allocated'));
    apiGet<OverAssignedResponse>('/reports-service/over-assigned')
      .then(setOverAssigned).catch(track('over-assigned'));
    apiGet<{ data: BudgetRow[] }>('/reports-service/budget-vs-planned')
      .then((r) => setBudgetRows(r.data)).catch(track('budget'));
    // Approved allocations across the whole portfolio — feeds the labour
    // component of `consumed` so per-project + portfolio totals on this
    // page line up with each project's Budget tab.
    apiGet<ListResponse<Allocation>>('/allocations-service?approval_status=approved&limit=500')
      .then((r) => setAllAllocs(r.data)).catch(track('allocations'));

    apiGet<ListResponse<Project>>('/projects-service?limit=200')
      .then((r) => setProjects(r.data)).catch(() => setProjects([]));
    apiGet<ListResponse<User>>('/resources-service?limit=200')
      .then((r) => setUsers(r.data)).catch(() => setUsers([]));
  }, [apiGet]);

  // ---- portfolio budget aggregate (Q7 headline) --------------------------
  //
  // Projects can be denominated in any currency (USD, EUR, GBP, …). Summing
  // raw `planned` / `consumed` across currencies would be meaningless — a
  // €850k project must not silently inflate a USD total. Group by currency
  // and surface one total per bucket so the figure shown matches what a
  // user sees on each individual project's Budget tab.

  // Per-project labour cost, mirroring BudgetPanel: group every approved
  // allocation by user, then for each allocation charge per-day
  // `DAILY_RATE / concurrent active projects that day` to that allocation's
  // project. Labour is denominated in USD by the rate formula in
  // utils/laborCost.ts — non-USD projects therefore mix USD labour into a
  // non-USD ceiling, which matches the per-project Budget tab's existing
  // (imperfect but consistent) presentation.
  const laborByProject = useMemo<Record<string, number>>(() => {
    if (!allAllocs) return {};
    const byUser = new Map<string, Allocation[]>();
    for (const a of allAllocs) {
      const list = byUser.get(a.user_id) ?? [];
      list.push(a);
      byUser.set(a.user_id, list);
    }
    const totals: Record<string, number> = {};
    for (const a of allAllocs) {
      const peers = byUser.get(a.user_id) ?? [a];
      totals[a.project_id] = (totals[a.project_id] ?? 0) + computeLaborCost(a, peers);
    }
    return totals;
  }, [allAllocs]);

  // Equipment `consumed` (from the report endpoint) + labour (computed here)
  // per project. All downstream aggregates use this enriched list so the
  // KPI tile, per-currency footer, and per-project list share one figure.
  const enrichedBudgetRows = useMemo<BudgetRow[] | null>(() => {
    if (!budgetRows) return null;
    return budgetRows.map((r) => {
      const labor = laborByProject[r.project_id] ?? 0;
      const totalConsumed = num(r.consumed) + labor;
      return { ...r, consumed: totalConsumed.toFixed(2) };
    });
  }, [budgetRows, laborByProject]);

  interface CurrencyBucket {
    currency: string;
    planned: number;
    consumed: number;
    ratio: number;
    projectCount: number;
  }

  const budgetByCurrency = useMemo<CurrencyBucket[] | null>(() => {
    if (!enrichedBudgetRows) return null;
    const buckets = new Map<string, CurrencyBucket>();
    for (const r of enrichedBudgetRows) {
      const currency = (r.currency || 'USD').toUpperCase();
      const entry = buckets.get(currency) ?? {
        currency, planned: 0, consumed: 0, ratio: 0, projectCount: 0,
      };
      entry.planned     += num(r.planned);
      entry.consumed    += num(r.consumed);
      entry.projectCount += 1;
      buckets.set(currency, entry);
    }
    return [...buckets.values()]
      .map((b) => ({ ...b, ratio: b.planned > 0 ? b.consumed / b.planned : 0 }))
      // Largest planned first — the dominant bucket drives the KPI headline.
      .sort((a, b) => b.planned - a.planned);
  }, [enrichedBudgetRows]);

  // The headline tile shows the dominant currency's burn ratio; the hint /
  // footer enumerate the rest so nothing gets summed across currencies.
  const headlineBucket = budgetByCurrency?.[0] ?? null;
  const worstRatio = budgetByCurrency
    ? Math.max(0, ...budgetByCurrency.map((b) => b.ratio))
    : 0;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label-caps">Analytics · Telemetry</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            Reports
          </h1>
        </div>
        <p className="max-w-md text-xs text-ink-500">
          Portfolio-wide aggregates from <code className="rounded bg-ink-200/40 px-1 font-mono">reports-service</code>.
          Schedule risk, budget burn, and team workload are read at page
          load — no polling on this surface.
        </p>
      </header>

      {/* ----------------------------------------------------------------- */}
      {/* 1. Headline KPI strip                                              */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Projects at risk"
          tone={atRisk && atRisk.length > 0 ? 'ember' : 'jade'}
          value={atRisk ? atRisk.length : '—'}
          hint={atRisk && atRisk.length === 0 ? 'all on track' : 'have overdue deliverables'}
        />
        <KpiTile
          label="Overworked users"
          tone={overAssigned && overAssigned.data.length > 0 ? 'amber' : 'jade'}
          value={overAssigned ? overAssigned.data.length : '—'}
          hint={
            overAssigned
              ? `> ${overAssigned.meta.project_threshold} projects or > ${overAssigned.meta.deliverable_threshold} deliverables`
              : 'loading…'
          }
        />
        <KpiTile
          label="Allocation overlaps"
          tone={overAlloc && overAlloc.length > 0 ? 'amber' : 'jade'}
          value={overAlloc ? overAlloc.length : '—'}
          hint="users with date-overlapping allocations"
        />
        <KpiTile
          label="Portfolio budget"
          tone={
            !headlineBucket           ? 'ink'   :
            worstRatio > 1            ? 'ember' :
            worstRatio > 0.85         ? 'amber' :
                                        'jade'
          }
          value={
            headlineBucket
              ? `${Math.round(headlineBucket.ratio * 100)}%`
              : '—'
          }
          hint={
            budgetByCurrency && budgetByCurrency.length > 0 ? (
              <div className="space-y-0.5">
                {budgetByCurrency.map((b) => (
                  <div key={b.currency} className="tnum">
                    <span className="font-mono text-[11px] text-ink-400">{b.currency}</span>{' '}
                    {formatMoney(b.consumed, b.currency)} of {formatMoney(b.planned, b.currency)}
                  </div>
                ))}
              </div>
            ) : 'loading…'
          }
          footer={
            headlineBucket && headlineBucket.planned > 0 ? (
              <BudgetBar
                planned={headlineBucket.planned}
                consumed={headlineBucket.consumed}
                currency={headlineBucket.currency}
                compact
              />
            ) : undefined
          }
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* 2. Projects at risk (Q2)                                           */}
      {/* ----------------------------------------------------------------- */}
      <Card
        eyebrow="Schedule health"
        title="Projects at risk"
        actions={
          atRisk && atRisk.length > 0 && (
            <span className="rounded-full bg-ember-50 px-2 py-0.5 font-mono tnum text-[11px] text-ember-700 ring-1 ring-inset ring-ember-100">
              {atRisk.reduce((s, r) => s + r.outdated_count, 0)} overdue deliverables
            </span>
          )
        }
      >
        <ReportState err={errors['at-risk']} empty={atRisk?.length === 0 ? 'No projects at risk — every deliverable is on time.' : null} loading={!atRisk} />
        {atRisk && atRisk.length > 0 && (
          <ReportTable
            head={['Project', 'Status', 'Overdue', 'Target end']}
            sortValues={atRisk.map((r) => [
              r.name,
              r.status,
              r.outdated_count,
              r.target_end_date ?? '',
            ])}
            rows={atRisk.map((r) => {
              const maxOverdue = Math.max(...atRisk.map((x) => x.outdated_count), 1);
              return [
                canDeepLink ? (
                  <Link to={`/projects/${r.id}`} className="font-medium text-ink-900 hover:text-brand-700">{r.name}</Link>
                ) : (
                  <span className="font-medium text-ink-900">{r.name}</span>
                ),
                <StatusBadge status={r.status} />,
                <div className="flex items-center gap-2">
                  <span className="w-7 font-mono tnum text-ember-700">{r.outdated_count}</span>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ember-50">
                    <div className="h-full rounded-full bg-ember-500"
                         style={{ width: `${(r.outdated_count / maxOverdue) * 100}%` }} />
                  </div>
                </div>,
                <span className="font-mono tnum text-ink-700">{r.target_end_date ?? '—'}</span>,
              ];
            })}
          />
        )}
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* 3. Budget vs planned (Q7)                                          */}
      {/* ----------------------------------------------------------------- */}
      <Card
        eyebrow="Spend"
        title="Budget vs planned"
        actions={
          budgetRows && (
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 font-mono tnum text-[11px] text-ink-500">
              <span>
                {budgetRows.filter((r) => num(r.planned) > 0).length} of {budgetRows.length} budgeted
              </span>
              {budgetByCurrency?.map((b) => (
                <span key={b.currency} className="text-ink-700">
                  <span className="text-ink-400">{b.currency}</span>{' '}
                  {formatMoney(b.consumed, b.currency)} / {formatMoney(b.planned, b.currency)}
                </span>
              ))}
            </div>
          )
        }
      >
        <ReportState err={errors['budget']} empty={budgetRows?.length === 0 ? 'No projects in the portfolio yet.' : null} loading={!budgetRows} />
        {enrichedBudgetRows && enrichedBudgetRows.length > 0 && (
          <ul className="divide-y divide-line">
            {[...enrichedBudgetRows]
              .sort((a, b) => {
                // Over-spent first, then biggest consumed %, then alpha.
                const ra = num(a.planned) > 0 ? num(a.consumed) / num(a.planned) : 0;
                const rb = num(b.planned) > 0 ? num(b.consumed) / num(b.planned) : 0;
                return rb - ra;
              })
              .map((r) => {
                const planned  = num(r.planned);
                const consumed = num(r.consumed);
                const noBudget = planned === 0;
                return (
                  <li key={r.project_id} className="grid grid-cols-1 items-center gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                    <div className="min-w-0">
                      {canDeepLink ? (
                        <Link to={`/projects/${r.project_id}`} className="block truncate font-medium text-ink-900 hover:text-brand-700">
                          {r.name}
                        </Link>
                      ) : (
                        <span className="block truncate font-medium text-ink-900">{r.name}</span>
                      )}
                      {noBudget && (
                        <span className="mt-0.5 inline-block rounded bg-ink-200/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-500">
                          no ceiling set
                        </span>
                      )}
                    </div>
                    {noBudget ? (
                      <div className="text-xs text-ink-400">
                        Consumed{' '}
                        <span className="font-mono tnum text-ink-700">
                          {formatMoney(consumed, r.currency || 'USD')}
                        </span>{' '}
                        with no planned ceiling.
                      </div>
                    ) : (
                      <BudgetBar planned={planned} consumed={consumed} currency={r.currency || 'USD'} />
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* 4. Workload — overworked + overlapping (Q5)                        */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card
          eyebrow="Workload"
          title="Overworked users"
          actions={
            overAssigned && (
              <span className="hidden font-mono text-[10px] uppercase tracking-wider text-ink-400 sm:inline">
                thresholds · {overAssigned.meta.project_threshold}p / {overAssigned.meta.deliverable_threshold}d
              </span>
            )
          }
        >
          <ReportState
            err={errors['over-assigned']}
            empty={overAssigned?.data.length === 0 ? 'No one is currently over the workload thresholds.' : null}
            loading={!overAssigned}
          />
          {overAssigned && overAssigned.data.length > 0 && (
            <ul className="divide-y divide-line">
              {overAssigned.data.map((u) => {
                const pPct = Math.min(100, (u.active_project_count    / Math.max(overAssigned.meta.project_threshold     * 2, 1)) * 100);
                const dPct = Math.min(100, (u.active_deliverable_count / Math.max(overAssigned.meta.deliverable_threshold * 2, 1)) * 100);
                return (
                  <li key={u.user_id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink-900">{u.full_name || u.email}</div>
                        <div className="truncate font-mono text-[11px] text-ink-400">{u.email}</div>
                      </div>
                      <div className="flex gap-1">
                        {u.exceeds_project_threshold && (
                          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-100">
                            projects
                          </span>
                        )}
                        {u.exceeds_deliverable_threshold && (
                          <span className="rounded-full bg-ember-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ember-700 ring-1 ring-inset ring-ember-100">
                            deliverables
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                      <WorkloadBar
                        label="Active projects"
                        value={u.active_project_count}
                        threshold={overAssigned.meta.project_threshold}
                        pct={pPct}
                        breached={u.exceeds_project_threshold}
                      />
                      <WorkloadBar
                        label="Open deliverables"
                        value={u.active_deliverable_count}
                        threshold={overAssigned.meta.deliverable_threshold}
                        pct={dPct}
                        breached={u.exceeds_deliverable_threshold}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card eyebrow="Cross-check" title="Allocation overlaps">
          <ReportState
            err={errors['over-allocated']}
            empty={overAlloc?.length === 0 ? 'No users have overlapping approved allocations.' : null}
            loading={!overAlloc}
          />
          {overAlloc && overAlloc.length > 0 && (
            <ReportTable
              head={['User', 'Peak overlap']}
              sortValues={overAlloc.map((u) => [u.full_name || u.email, u.peak_overlap])}
              rows={overAlloc.map((u) => {
                const max = Math.max(...overAlloc.map((x) => x.peak_overlap), 1);
                return [
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink-900">{u.full_name || u.email}</div>
                    <div className="truncate font-mono text-[11px] text-ink-400">{u.email}</div>
                  </div>,
                  <div className="flex items-center gap-2">
                    <span className="w-6 font-mono tnum text-amber-700">{u.peak_overlap}</span>
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-amber-50">
                      <div className="h-full rounded-full bg-amber-500" style={{ width: `${(u.peak_overlap / max) * 100}%` }} />
                    </div>
                  </div>,
                ];
              })}
            />
          )}
        </Card>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* 5. Per-project / per-user lookup tools                              */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <DeliverableCompletionTool projects={projects} />
        <DeliverableChainTool projects={projects} />
        <AllocationByUserTool users={users} />
      </div>
    </section>
  );
}

/* ============================================================================
   Shared internal sub-components — pure presentation.
   ========================================================================== */

function ReportState({ err, empty, loading }: { err?: string; empty?: string | null; loading: boolean }) {
  if (err) {
    return <p className="rounded-md border border-ember-100 bg-ember-50 px-3 py-2 text-xs text-ember-700">{err}</p>;
  }
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-3 w-full overflow-hidden rounded bg-surface-2">
            <div className="h-full w-1/3 bg-ink-200/60" />
          </div>
        ))}
      </div>
    );
  }
  if (empty) {
    return (
      <div className="rounded-md border border-dashed border-line bg-surface-2 p-4 text-center text-xs text-ink-500">
        {empty}
      </div>
    );
  }
  return null;
}

interface ReportTableProps {
  head: string[];
  rows: React.ReactNode[][];
  /**
   * Optional parallel matrix of raw values used for sorting. When provided,
   * column headers become clickable; one entry per row, one number/string per
   * column. Pass `null` for a column to opt that column out of sorting.
   */
  sortValues?: (string | number | null)[][];
}

function ReportTable({ head, rows, sortValues }: ReportTableProps) {
  // Pair each row with its raw sort values so the sort hook can key off
  // columns without us having to lift the schema out of the parent.
  const sortable = sortValues !== undefined;
  type RowBundle = { cells: React.ReactNode[]; vals: (string | number | null)[]; idx: number };
  const bundles: RowBundle[] = rows.map((cells, idx) => ({
    cells,
    vals: sortValues?.[idx] ?? [],
    idx,
  }));

  // Build accessors keyed by column index ("c0", "c1", …). Columns whose
  // sortValue is null in every row stay un-sortable.
  const accessors: Record<string, (b: RowBundle) => string | number> = {};
  if (sortable) {
    head.forEach((_, ci) => {
      const anyValue = bundles.some((b) => b.vals[ci] != null);
      if (anyValue) {
        accessors[`c${ci}`] = (b) => {
          const v = b.vals[ci];
          return v ?? '';
        };
      }
    });
  }

  // Default initial sort: first sortable column ascending; falls back to
  // a no-op key if no column is sortable (keeps the hook signature stable).
  const firstSortable = Object.keys(accessors)[0] ?? 'none';
  const { sorted, sort, setSort } = useSortableTable(
    bundles,
    sortable ? accessors : { none: () => 0 },
    { key: firstSortable, dir: 'asc' },
  );

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr>
            {head.map((h, ci) => {
              const key = `c${ci}`;
              if (sortable && accessors[key]) {
                return (
                  <SortableHeader
                    key={h}
                    sortKey={key}
                    sort={sort}
                    setSort={setSort}
                    className="label-caps border-b border-line"
                  >
                    {h}
                  </SortableHeader>
                );
              }
              return (
                <th key={h} scope="col" className="label-caps border-b border-line px-3 py-2 text-left">
                  {h}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((b) => (
            <tr key={b.idx} className="border-b border-line last:border-0">
              {b.cells.map((cell, j) => (
                <td key={j} className="px-3 py-2.5 align-middle">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorkloadBar({
  label, value, threshold, pct, breached,
}: { label: string; value: number; threshold: number; pct: number; breached: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-caps">{label}</span>
        <span className={`font-mono tnum ${breached ? 'text-ember-700' : 'text-ink-700'}`}>
          {value}<span className="text-ink-300">/{threshold}</span>
        </span>
      </div>
      <div className="relative mt-1 h-1.5 overflow-visible rounded-full bg-ink-200/40">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${breached ? 'bg-ember-500' : 'bg-brand-600'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
        {/* Threshold tick at 50% of the bar (since pct caps at 2× threshold). */}
        <span aria-hidden className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-y-1/2 -translate-x-px bg-ink-400" />
      </div>
    </div>
  );
}

/* ============================================================================
   Per-project tool: deliverable completion gauge (Q4)
   ========================================================================== */

function DeliverableCompletionTool({ projects }: { projects: Project[] }) {
  const { apiGet } = useApi();
  const [projectId, setProjectId] = useState<string>('');
  const [result, setResult] = useState<CompletionRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) { setResult(null); return; }
    setLoading(true); setErr(null);
    apiGet<{ data: CompletionRow }>(
      `/reports-service/deliverable-completion?project_id=${encodeURIComponent(projectId)}`,
    )
      .then((r) => setResult(r.data))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [apiGet, projectId]);

  return (
    <Card eyebrow="Project drill-down" title="Deliverable completion">
      <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
      {!projectId && (
        <p className="mt-3 text-xs text-ink-400">Pick a project to gauge completion.</p>
      )}
      {projectId && loading && <p className="mt-3 text-xs text-ink-400">Computing…</p>}
      {projectId && err && (
        <p className="mt-3 rounded-md border border-ember-100 bg-ember-50 px-2 py-1.5 text-xs text-ember-700">{err}</p>
      )}
      {projectId && result && !loading && (
        <div className="mt-4 space-y-2">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="font-display text-3xl font-semibold tracking-tight text-ink-900 tnum">
                {result.percent_complete.toFixed(1)}<span className="text-base text-ink-400">%</span>
              </div>
              <div className="label-caps">complete</div>
            </div>
            <div className="text-right text-xs text-ink-500">
              <div><span className="font-mono tnum text-ink-900">{result.completed}</span> done</div>
              <div><span className="font-mono tnum text-ink-700">{result.total}</span> total</div>
            </div>
          </div>
          <ProgressBar value={result.percent_complete} tone="auto" />
        </div>
      )}
    </Card>
  );
}

/* ============================================================================
   Per-project tool: deliverable dependency chain (Q6)
   ========================================================================== */

function DeliverableChainTool({ projects }: { projects: Project[] }) {
  const { apiGet } = useApi();
  const [projectId, setProjectId] = useState<string>('');
  const [chain, setChain] = useState<ChainRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) { setChain(null); return; }
    setLoading(true); setErr(null);
    apiGet<{ data: ChainRow[] }>(
      `/reports-service/deliverable-chain?project_id=${encodeURIComponent(projectId)}`,
    )
      .then((r) => setChain(r.data))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [apiGet, projectId]);

  const maxDepth = chain ? Math.max(0, ...chain.map((c) => c.depth)) : 0;

  return (
    <Card
      eyebrow="Project drill-down"
      title="Dependency chain"
      actions={chain && chain.length > 0 && (
        <span className="font-mono tnum text-[11px] text-ink-500">
          depth {maxDepth} · {chain.length} nodes
        </span>
      )}
    >
      <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
      {!projectId && (
        <p className="mt-3 text-xs text-ink-400">Pick a project to walk its deliverable graph.</p>
      )}
      {projectId && loading && <p className="mt-3 text-xs text-ink-400">Walking the graph…</p>}
      {projectId && err && (
        <p className="mt-3 rounded-md border border-ember-100 bg-ember-50 px-2 py-1.5 text-xs text-ember-700">{err}</p>
      )}
      {projectId && chain && chain.length === 0 && (
        <p className="mt-3 rounded-md border border-dashed border-line bg-surface-2 p-3 text-center text-xs text-ink-500">
          No deliverables on this project.
        </p>
      )}
      {projectId && chain && chain.length > 0 && (
        <ul className="mt-3 space-y-1 font-mono text-[12px]">
          {chain.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              {/* Depth gutter — one cobalt rung per level. */}
              <span className="flex shrink-0 items-center" aria-hidden>
                {Array.from({ length: c.depth }).map((_, i) => (
                  <span key={i} className="block h-3 w-3 border-l-2 border-brand-100" />
                ))}
                <span className={`h-1.5 w-1.5 rounded-full ${c.depth === 0 ? 'bg-brand-600' : 'bg-brand-300'}`} />
              </span>
              <span className="truncate text-ink-900">{c.title}</span>
              {c.depends_on === null && (
                <span className="ml-auto rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700">
                  root
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ============================================================================
   Per-user tool: allocation rollup with optional date window (Q3 slice)
   ========================================================================== */

function AllocationByUserTool({ users }: { users: User[] }) {
  const { apiGet } = useApi();
  const [userId, setUserId] = useState<string>('');
  const [start, setStart]   = useState<string>('');
  const [end, setEnd]       = useState<string>('');
  const [rows, setRows]     = useState<AllocByUserRow[] | null>(null);
  const [err, setErr]       = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true); setErr(null);
    const params = new URLSearchParams();
    if (userId) params.set('user_id', userId);
    if (start)  params.set('start', start);
    if (end)    params.set('end', end);
    const qs = params.toString();
    apiGet<{ data: AllocByUserRow[] }>(
      `/reports-service/allocation-by-user${qs ? `?${qs}` : ''}`,
    )
      .then((r) => setRows(r.data))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [apiGet, userId, start, end]);

  const filtered = rows ?? [];
  const max = Math.max(1, ...filtered.map((r) => r.allocation_count));

  return (
    <Card
      eyebrow="Capacity lookup"
      title="Allocation by user"
      actions={
        (userId || start || end) && (
          <button
            type="button"
            onClick={() => { setUserId(''); setStart(''); setEnd(''); }}
            className="font-mono text-[11px] text-brand-700 hover:underline"
          >
            clear
          </button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-2">
        <label className="block">
          <span className="label-caps">User</span>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm"
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.email}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label-caps">From</span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="label-caps">To</span>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 font-mono text-xs"
            />
          </label>
        </div>
      </div>

      <div className="mt-4">
        {loading && <p className="text-xs text-ink-400">Loading…</p>}
        {err && (
          <p className="rounded-md border border-ember-100 bg-ember-50 px-2 py-1.5 text-xs text-ember-700">{err}</p>
        )}
        {!loading && !err && filtered.length === 0 && (
          <p className="rounded-md border border-dashed border-line bg-surface-2 p-3 text-center text-xs text-ink-500">
            No allocations match.
          </p>
        )}
        {!loading && !err && filtered.length > 0 && (
          <ul className="max-h-72 space-y-1.5 overflow-auto pr-1">
            {[...filtered]
              .sort((a, b) => b.allocation_count - a.allocation_count)
              .slice(0, 12)
              .map((r) => (
                <li key={r.user_id} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate text-ink-700">{r.full_name || r.email}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-200/40">
                    <div className="h-full rounded-full bg-brand-600"
                         style={{ width: `${(r.allocation_count / max) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right font-mono tnum text-ink-900">{r.allocation_count}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ProjectPicker({
  projects, value, onChange,
}: { projects: Project[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label-caps">Project</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm"
      >
        <option value="">— pick a project —</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </label>
  );
}

