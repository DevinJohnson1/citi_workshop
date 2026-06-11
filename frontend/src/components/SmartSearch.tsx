import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type ListResponse } from '../services/apiClient';
import type {
  Allocation,
  Deliverable,
  Equipment,
  Project,
  User,
} from '../types/api';
import { StatusBadge } from './ui/StatusBadge';
import { approvalLabel, equipmentStatusLabel } from '../utils/labels';

/** The four searchable item flavours plus the `all` umbrella. */
type Filter = 'all' | 'deliverables' | 'allocations' | 'tangibles' | 'intangibles';

interface FilterChip {
  key: Filter;
  label: string;
}

const FILTERS: FilterChip[] = [
  { key: 'all', label: 'All' },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'allocations', label: 'Allocations' },
  { key: 'tangibles', label: 'Tangibles' },
  { key: 'intangibles', label: 'Intangibles' },
];

/**
 * Props for {@link SmartSearch}.
 */
export interface SmartSearchProps {
  /**
   * When set, restrict every fetch to a single project. When `undefined`,
   * search the whole organisation — used by the global Resources page.
   */
  projectId?: string;
}

/**
 * Cross-resource search surface.
 *
 * Surfaces four data types (deliverables, allocations, tangibles,
 * intangibles) behind a single text input + filter chip strip. Matching
 * is name-based and case-insensitive across:
 *
 *   * Deliverable.title
 *   * Allocation → user.full_name / user.email
 *   * Equipment.name + assigned user's name (so "tangibles for Jane" lands)
 *
 * Used both on `ResourcesPage` (organisation-wide) and inside a project
 * (scoped via the `projectId` prop).
 */
export function SmartSearch({ projectId }: SmartSearchProps) {
  const { apiGet } = useApi();

  // Raw catalogues. Tangibles / intangibles share the equipment table — we
  // split them client-side on `is_tangible` so the result groups stay
  // pure.
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search state. Filter defaults to `all` so the first hit shows every
  // match without an extra click — the chips are a refinement, not a
  // required selection.
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // Fetch everything in parallel. Per-tab failures are not silenced —
  // we surface the first one because a partial set would be misleading
  // ("no deliverables for X" when really the request 500'd).
  useEffect(() => {
    setLoading(true);
    setError(null);
    const projectQs = projectId
      ? `?project_id=${encodeURIComponent(projectId)}&limit=200`
      : '?limit=200';
    const equipmentQs = projectId
      ? `?assigned_project_id=${encodeURIComponent(projectId)}&limit=200`
      : '?limit=200';
    Promise.all([
      apiGet<ListResponse<Deliverable>>(`/deliverables-service${projectQs}`),
      apiGet<ListResponse<Allocation>>(`/allocations-service${projectQs}`),
      apiGet<ListResponse<Equipment>>(`/equipment-service${equipmentQs}`),
      apiGet<ListResponse<User>>('/resources-service?limit=500'),
      // Project lookup so org-wide hits can render "→ ProjectName" badges.
      // For the project-scoped variant we still load it (cheap) so the
      // single project name shows correctly without a separate prop.
      apiGet<ListResponse<Project>>('/projects-service?limit=200'),
    ])
      .then(([d, a, e, u, p]) => {
        setDeliverables(d.data);
        setAllocations(a.data);
        setEquipment(e.data);
        setUsers(u.data);
        setProjects(p.data);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet, projectId]);

  // O(1) lookups for rendering — `users` / `projects` are small enough to
  // afford the map up front rather than .find() inside the JSX loop.
  const usersById = useMemo(() => {
    const m: Record<string, User> = {};
    for (const u of users) m[u.id] = u;
    return m;
  }, [users]);
  const projectsById = useMemo(() => {
    const m: Record<string, Project> = {};
    for (const p of projects) m[p.id] = p;
    return m;
  }, [projects]);

  const userLabel = (id: string | null): string => {
    if (!id) return '';
    const u = usersById[id];
    return u ? (u.full_name || u.email) : id;
  };
  const projectName = (id: string | null): string => {
    if (!id) return '';
    const p = projectsById[id];
    return p ? p.name : id;
  };

  // Matching is case-insensitive substring on trimmed query. Empty query
  // returns no results — the page is otherwise dominated by chrome and
  // we'd rather invite the user to type than show every row by default.
  const needle = query.trim().toLowerCase();
  const haystack = (s: string | null | undefined): boolean =>
    needle.length > 0 && !!s && s.toLowerCase().includes(needle);

  const matchedDeliverables = useMemo<Deliverable[]>(
    () =>
      filter !== 'all' && filter !== 'deliverables'
        ? []
        : deliverables.filter((d) => haystack(d.title)),
    [deliverables, filter, needle], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const matchedAllocations = useMemo<Allocation[]>(
    () =>
      filter !== 'all' && filter !== 'allocations'
        ? []
        : allocations.filter(
            (a) =>
              haystack(userLabel(a.user_id)) || haystack(a.role_description),
          ),
    // userLabel closes over usersById which is in deps below
    [allocations, filter, needle, usersById], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const matchedEquipment = useMemo<Equipment[]>(() => {
    if (filter !== 'all' && filter !== 'tangibles' && filter !== 'intangibles') return [];
    return equipment.filter((e) => {
      // Honour the tangibles/intangibles split when the user narrows the
      // filter to one of them.
      if (filter === 'tangibles' && !e.is_tangible) return false;
      if (filter === 'intangibles' && e.is_tangible) return false;
      return (
        haystack(e.name) ||
        haystack(e.kind) ||
        haystack(userLabel(e.assigned_user_id))
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment, filter, needle, usersById]);

  const tangibleHits = matchedEquipment.filter((e) => e.is_tangible);
  const intangibleHits = matchedEquipment.filter((e) => !e.is_tangible);
  const totalHits =
    matchedDeliverables.length +
    matchedAllocations.length +
    matchedEquipment.length;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded border border-line bg-surface p-4">
        <label className="block text-sm">
          <span className="text-ink-700">
            Search by name {projectId ? '(within this project)' : '(across the organisation)'}
          </span>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try a person, a deliverable title, or an asset name…"
            className="mt-1 block w-full rounded border border-line-strong px-3 py-2 text-sm"
            aria-label="Search resources"
          />
        </label>
        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1 text-xs ${
                  active
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-line-strong bg-surface text-ink-500 hover:text-ink-900'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded border border-ember-100 bg-ember-50 px-3 py-2 text-sm text-ember-700">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-ink-400">Loading…</p>}

      {!loading && needle.length === 0 && (
        <p className="text-sm text-ink-400">
          Start typing to search across deliverables, allocations, tangibles
          and intangibles. Use the filter chips above to narrow down to one
          type.
        </p>
      )}

      {!loading && needle.length > 0 && totalHits === 0 && (
        <p className="rounded border border-line bg-surface px-3 py-2 text-sm text-ink-500">
          No matches for <span className="font-mono">{query}</span>.
        </p>
      )}

      {/* Result groups — each is hidden when empty so the page stays tight. */}
      {matchedDeliverables.length > 0 && (
        <ResultGroup label="Deliverables" count={matchedDeliverables.length}>
          {matchedDeliverables.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
              <span className="min-w-0">
                <Link to={`/projects/${d.project_id}`} className="font-medium text-ink-900 hover:text-brand-700">
                  {d.title}
                </Link>
                {!projectId && (
                  <span className="ml-2 text-xs text-ink-400">in {projectName(d.project_id)}</span>
                )}
              </span>
              <span className="flex items-center gap-2 text-xs text-ink-500">
                <StatusBadge status={d.status} />
                {d.due_date && <span className="font-mono tnum">due {d.due_date}</span>}
              </span>
            </li>
          ))}
        </ResultGroup>
      )}

      {matchedAllocations.length > 0 && (
        <ResultGroup label="Allocations" count={matchedAllocations.length}>
          {matchedAllocations.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
              <span className="min-w-0">
                <Link to={`/projects/${a.project_id}`} className="font-medium text-ink-900 hover:text-brand-700">
                  {userLabel(a.user_id)}
                </Link>
                {a.role_description && (
                  <span className="ml-2 text-xs text-ink-500">— {a.role_description}</span>
                )}
                {!projectId && (
                  <span className="ml-2 text-xs text-ink-400">on {projectName(a.project_id)}</span>
                )}
              </span>
              <span className="flex items-center gap-2 text-xs text-ink-500">
                <span className="font-mono tnum">{a.start_date} → {a.end_date}</span>
                <span className="rounded bg-surface-2 px-1.5 py-0.5">{approvalLabel(a.approval_status)}</span>
              </span>
            </li>
          ))}
        </ResultGroup>
      )}

      {tangibleHits.length > 0 && (
        <ResultGroup label="Tangibles" count={tangibleHits.length}>
          {tangibleHits.map((e) => (
            <EquipmentRow key={e.id} item={e} userLabel={userLabel} projectName={projectName} showProject={!projectId} />
          ))}
        </ResultGroup>
      )}

      {intangibleHits.length > 0 && (
        <ResultGroup label="Intangibles" count={intangibleHits.length}>
          {intangibleHits.map((e) => (
            <EquipmentRow key={e.id} item={e} userLabel={userLabel} projectName={projectName} showProject={!projectId} />
          ))}
        </ResultGroup>
      )}
    </div>
  );
}

/** Collapsible-style group header + bordered list of result rows. */
function ResultGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-2 text-xs uppercase tracking-wide text-ink-500">
        <span>{label}</span>
        <span className="rounded-full bg-surface px-2 py-0.5 font-mono tnum text-ink-700">{count}</span>
      </header>
      <ul className="text-sm">{children}</ul>
    </section>
  );
}

/** Compact equipment row reused across the tangibles + intangibles groups. */
function EquipmentRow({
  item,
  userLabel,
  projectName,
  showProject,
}: {
  item: Equipment;
  userLabel: (id: string | null) => string;
  projectName: (id: string | null) => string;
  showProject: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
      <span className="min-w-0">
        <span className="font-medium text-ink-900">{item.name}</span>
        <span className="ml-2 text-xs text-ink-400">{item.kind}</span>
        {item.assigned_user_id && (
          <span className="ml-2 text-xs text-ink-500">→ {userLabel(item.assigned_user_id)}</span>
        )}
        {showProject && item.assigned_project_id && (
          <span className="ml-2 text-xs text-ink-400">on {projectName(item.assigned_project_id)}</span>
        )}
      </span>
      <span className="flex items-center gap-2 text-xs text-ink-500">
        <span className="rounded bg-surface-2 px-1.5 py-0.5">{equipmentStatusLabel(item.status)}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5">{approvalLabel(item.approval_status)}</span>
      </span>
    </li>
  );
}

