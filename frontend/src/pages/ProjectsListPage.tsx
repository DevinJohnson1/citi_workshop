import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, type ListResponse } from '../services/apiClient';
import { useHasRole } from '../auth/useRole';
import type { Deliverable, Project, ProjectStatus } from '../types/api';
import { StatusBadge } from '../components/ui/StatusBadge';
import { HealthStrip } from '../components/ui/HealthStrip';
import { prettyLabel } from '../utils/labels';

const STATUSES: ProjectStatus[] = ['planned', 'active', 'on_hold', 'done', 'cancelled'];

/**
 * Projects list — answers Q1 & Q2 in list form.
 *
 * The redesign keeps every filter / sort / search behaviour intact: the
 * `query`, `status`, and `atRisk` state still translate one-for-one into
 * the same URL params (`q`, `status`, `at_risk`) the original backend
 * already supports.  The page additionally hydrates URL params on mount
 * so deep-links from the dashboard (`/projects?status=active`,
 * `/projects?at_risk=true`, `/projects?q=foo`) work — a behaviour the
 * dashboard tiles assumed without it actually existing before.
 *
 * Visual change: every row carries a HealthStrip showing its deliverables
 * at a glance, so the at-risk question can be answered without drilling.
 */
export function ProjectsListPage() {
  const { apiGet } = useApi();
  const canCreate = useHasRole('admin', 'team_lead');

  // --- URL-driven initial state (preserves the existing filter contract).
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery]   = useState(searchParams.get('q') ?? '');
  const [status, setStatus] = useState<ProjectStatus | ''>(
    (searchParams.get('status') as ProjectStatus | null) ?? '',
  );
  const [atRisk, setAtRisk] = useState(searchParams.get('at_risk') === 'true');

  const [rows, setRows]     = useState<Project[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  // Mirror state → URL so the page is shareable / bookmarkable.
  useEffect(() => {
    const next = new URLSearchParams();
    if (query)  next.set('q', query);
    if (status) next.set('status', status);
    if (atRisk) next.set('at_risk', 'true');
    setSearchParams(next, { replace: true });
  }, [query, status, atRisk, setSearchParams]);

  // Primary list fetch — unchanged contract.
  useEffect(() => {
    const params = new URLSearchParams();
    if (query)  params.set('q', query);
    if (status) params.set('status', status);
    if (atRisk) params.set('at_risk', 'true');
    const qs = params.toString();
    setLoading(true);
    setError(null);
    apiGet<ListResponse<Project>>(`/projects-service${qs ? `?${qs}` : ''}`)
      .then((res) => setRows(res.data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet, query, status, atRisk]);

  // Health strips on each row — fetched once per page load.
  useEffect(() => {
    apiGet<ListResponse<Deliverable>>('/deliverables-service?limit=500')
      .then((r) => setDeliverables(r.data))
      .catch(() => setDeliverables([]));
  }, [apiGet]);

  const deliverablesByProject = useMemo(() => {
    const map = new Map<string, Deliverable[]>();
    deliverables.forEach((d) => {
      const arr = map.get(d.project_id) ?? [];
      arr.push(d);
      map.set(d.project_id, arr);
    });
    return map;
  }, [deliverables]);

  const activeFilterCount = (query ? 1 : 0) + (status ? 1 : 0) + (atRisk ? 1 : 0);

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label-caps">Catalogue</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">Projects</h1>
        </div>
        {canCreate && (
          <Link
            to="/projects/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-card hover:bg-brand-700"
          >
            <span aria-hidden>＋</span> New project
          </Link>
        )}
      </header>

      {/* Filter bar */}
      <div className="rounded-lg bg-surface p-3 shadow-card">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto]">
          <label className="block">
            <span className="label-caps">Search</span>
            <div className="relative mt-1">
              <svg viewBox="0 0 20 20" aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="9" cy="9" r="5" />
                <path d="m13 13 3.5 3.5" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="name contains…"
                className="w-full rounded-md border border-line bg-surface-2 py-1.5 pl-8 pr-2 text-sm placeholder:text-ink-300 focus:border-brand-500"
              />
            </div>
          </label>
          <label className="block">
            <span className="label-caps">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus | '')}
              className="mt-1 w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm focus:border-brand-500"
            >
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{prettyLabel(s)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2">
            <span className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface-2 px-3 text-sm">
              <input
                type="checkbox"
                checked={atRisk}
                onChange={(e) => setAtRisk(e.target.checked)}
                className="h-3.5 w-3.5 accent-ember-500"
              />
              <span className="text-ink-700">Only at-risk</span>
            </span>
          </label>
        </div>
        {activeFilterCount > 0 && (
          <div className="mt-2 flex items-center justify-between text-xs text-ink-500">
            <span>{activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} applied</span>
            <button
              type="button"
              onClick={() => { setQuery(''); setStatus(''); setAtRisk(false); }}
              className="text-brand-700 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {loading && <p className="text-sm text-ink-400">Loading…</p>}
      {error   && <p className="rounded-md border border-ember-100 bg-ember-50 px-3 py-2 text-sm text-ember-700">{error}</p>}

      {!loading && !error && (
        <div className="overflow-hidden rounded-lg bg-surface shadow-card">
          <div className="hidden grid-cols-[2fr_120px_120px_2fr] items-center gap-3 border-b border-line bg-surface-2 px-4 py-2 md:grid">
            <span className="label-caps">Project</span>
            <span className="label-caps">Status</span>
            <span className="label-caps">Target end</span>
            <span className="label-caps">Health pulse</span>
          </div>
          {rows.length === 0 && (
            <div className="px-4 py-12 text-center">
              <div className="font-display text-base font-semibold text-ink-700">No projects match.</div>
              <p className="mt-1 text-xs text-ink-500">Try clearing filters or widening your search.</p>
            </div>
          )}
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              const projDeliverables = deliverablesByProject.get(row.id) ?? [];
              return (
                <li key={row.id}>
                  <Link
                    to={`/projects/${row.id}`}
                    className="grid grid-cols-1 items-center gap-2 px-4 py-3 transition-colors hover:bg-surface-2 md:grid-cols-[2fr_120px_120px_2fr] md:gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-ink-900">{row.name}</span>
                        {row.is_at_risk && (
                          <span className="rounded-full bg-ember-50 px-1.5 py-0.5 text-[10px] font-semibold text-ember-700 ring-1 ring-inset ring-ember-100">
                            AT RISK
                          </span>
                        )}
                      </div>
                      {row.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-ink-500">{row.description}</p>
                      )}
                    </div>
                    <div className="md:contents">
                      <div><StatusBadge status={row.status} /></div>
                      <div className="font-mono tnum text-xs text-ink-500">
                        {row.target_end_date ?? '—'}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <HealthStrip deliverables={projDeliverables} project={row} height={4} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

