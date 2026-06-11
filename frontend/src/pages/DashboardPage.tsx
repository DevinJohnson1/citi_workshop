import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import type { Deliverable, Project } from '../types/api';
import { KpiTile } from '../components/ui/KpiTile';
import { Card } from '../components/ui/Card';
import { HealthStrip } from '../components/ui/HealthStrip';
import { StatusBadge } from '../components/ui/StatusBadge';

/**
 * Dashboard — the at-a-glance view of the whole portfolio.
 *
 * Above-the-fold KPI strip: total / active projects, projects at risk,
 * deliverables overdue, deliverables in motion. Below: portfolio Health
 * Pulse + the actionable at-risk list with per-project mini strips.
 *
 * Business logic (API calls, viewer-role gating around the projects link)
 * is preserved from the original DashboardPage; the deliverables fetch is
 * additive — it powers the Health Pulse and does not change any existing
 * contract. Viewer-role users still see plain (non-link) KPI tiles for
 * `/projects` targets because `to={null}` renders KpiTile as a static div.
 */
export function DashboardPage() {
  const { apiGet } = useApi();
  const role = useRole();
  const canOpenProjects = role === 'team_lead' || role === 'team_member';

  const [projects, setProjects]         = useState<Project[] | null>(null);
  const [atRisk, setAtRisk]             = useState<Project[] | null>(null);
  const [deliverables, setDeliverables] = useState<Deliverable[] | null>(null);

  useEffect(() => {
    apiGet<ListResponse<Project>>('/projects-service?limit=100')
      .then((r) => setProjects(r.data))
      .catch(() => setProjects([]));
    apiGet<{ data: Project[] }>('/reports-service/at-risk')
      .then((r) => setAtRisk(r.data))
      .catch(() => setAtRisk([]));
    apiGet<ListResponse<Deliverable>>('/deliverables-service?limit=300')
      .then((r) => setDeliverables(r.data))
      .catch(() => setDeliverables([]));
  }, [apiGet]);

  const stats = useMemo(() => {
    const overdue  = (deliverables ?? []).filter((d) => d.is_outdated).length;
    const inMotion = (deliverables ?? []).filter((d) => d.status === 'in_progress').length;
    const active   = (projects ?? []).filter((p) => p.status === 'active').length;
    return { overdue, inMotion, active };
  }, [deliverables, projects]);

  const deliverablesByProject = useMemo(() => {
    const map = new Map<string, Deliverable[]>();
    (deliverables ?? []).forEach((d) => {
      const arr = map.get(d.project_id) ?? [];
      arr.push(d);
      map.set(d.project_id, arr);
    });
    return map;
  }, [deliverables]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label-caps">Telemetry · Portfolio</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">Dashboard</h1>
        </div>
        <p className="max-w-md text-xs text-ink-500">
          Health, risk and budget across every active engagement. Numbers
          refresh on load — no live polling on data-dense surfaces.
        </p>
      </header>

      {/* KPI strip — answers Q1 and Q2 in <3 s. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Active projects"
          value={projects ? stats.active : '—'}
          hint={projects ? `${projects.length} total in portfolio` : 'loading…'}
          tone="brand"
          to={canOpenProjects ? '/projects?status=active' : null}
        />
        <KpiTile
          label="At risk"
          value={atRisk ? atRisk.length : '—'}
          hint={atRisk && atRisk.length === 0 ? 'all on track' : 'overdue deliverables present'}
          tone={atRisk && atRisk.length > 0 ? 'ember' : 'jade'}
          to={canOpenProjects ? '/projects?at_risk=true' : null}
        />
        <KpiTile
          label="Overdue deliverables"
          value={deliverables ? stats.overdue : '—'}
          hint="past due date, not done"
          tone={stats.overdue > 0 ? 'ember' : 'jade'}
        />
        <KpiTile
          label="In motion"
          value={deliverables ? stats.inMotion : '—'}
          hint="deliverables actively worked"
          tone="ink"
        />
      </div>

      {/* Portfolio Health Pulse — the signature element, at full canvas width. */}
      <Card
        eyebrow="Portfolio · Live"
        title="Health pulse"
        actions={
          <span className="hidden flex-wrap items-center gap-2 text-[11px] text-ink-500 lg:flex">
            <Legend tone="bg-jade-500" label="done" />
            <Legend tone="bg-brand-600" label="in progress" />
            <Legend tone="bg-amber-500" label="blocked" />
            <Legend tone="bg-ember-500" label="overdue" />
            <Legend tone="bg-ink-200"  label="todo" />
          </span>
        }
      >
        <HealthStrip deliverables={deliverables ?? []} height={8} showCounts />
        <p className="mt-2 text-xs text-ink-500">
          Each cell is one deliverable across the portfolio. Ember cells are overdue work.
        </p>
      </Card>

      {/* At-risk list — answers Q2 directly. */}
      <Card
        eyebrow="Needs attention"
        title="Projects at risk"
        actions={canOpenProjects ? (
          <Link to="/projects?at_risk=true" className="text-xs font-medium text-brand-700 hover:underline">
            See all →
          </Link>
        ) : undefined}
      >
        {!atRisk && <p className="text-sm text-ink-400">Loading…</p>}
        {atRisk && atRisk.length === 0 && (
          <div className="rounded-md border border-dashed border-line bg-surface-2 p-6 text-center">
            <div className="font-display text-lg font-semibold text-jade-700">No projects at risk</div>
            <p className="mt-1 text-xs text-ink-500">Every project has its deliverables on or ahead of schedule.</p>
          </div>
        )}
        {atRisk && atRisk.length > 0 && (
          <ul className="divide-y divide-line">
            {atRisk.map((p) => {
              const projDeliverables = deliverablesByProject.get(p.id) ?? [];
              const overdue = projDeliverables.filter((d) => d.is_outdated).length;
              return (
                <li key={p.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      {canOpenProjects ? (
                        <Link
                          to={`/projects/${p.id}`}
                          className="block truncate font-medium text-ink-900 hover:text-brand-700"
                        >
                          {p.name}
                        </Link>
                      ) : (
                        <span className="block truncate font-medium text-ink-700">{p.name}</span>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                        <StatusBadge status={p.status} variant="dot" />
                        {p.target_end_date && (
                          <span className="font-mono tnum">target {p.target_end_date}</span>
                        )}
                        <span className="rounded-full bg-ember-50 px-1.5 py-0.5 font-mono tnum text-[11px] text-ember-700">
                          {overdue} overdue
                        </span>
                      </div>
                    </div>
                    <div className="w-full sm:w-72">
                      <HealthStrip deliverables={projDeliverables} project={p} height={4} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card eyebrow="Quick links" title="Where to next?">
          <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {canOpenProjects && (
              <li><Link to="/projects" className="block rounded-md border border-line bg-surface-2 px-3 py-2 hover:border-brand-300 hover:bg-brand-50">All projects →</Link></li>
            )}
            {canOpenProjects && (
              <li><Link to="/resources" className="block rounded-md border border-line bg-surface-2 px-3 py-2 hover:border-brand-300 hover:bg-brand-50">Resource allocation →</Link></li>
            )}
            <li><Link to="/reports" className="block rounded-md border border-line bg-surface-2 px-3 py-2 hover:border-brand-300 hover:bg-brand-50">Reports →</Link></li>
          </ul>
        </Card>

        <Card eyebrow="Reading the strip" title="Three-second test">
          <p className="text-sm text-ink-700">
            Mostly <span className="font-medium text-jade-700">jade</span> and{' '}
            <span className="font-medium text-brand-700">cobalt</span> — the
            portfolio is healthy. Any <span className="font-medium text-ember-700">ember</span>{' '}
            cells mean overdue work; <span className="font-medium text-amber-700">amber</span>{' '}
            cells are blocked. <span className="text-ink-500">Inert grey</span> is to-do, not yet started.
          </p>
        </Card>
      </div>
    </section>
  );
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone}`} />
      {label}
    </span>
  );
}

