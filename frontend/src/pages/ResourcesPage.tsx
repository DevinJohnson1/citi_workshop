import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import { OverworkBadge } from '../components/OverworkBadge';
import type {
  Deliverable,
  Equipment,
  EquipmentStatus,
  Project,
  ResourceKind,
  User,
} from '../types/api';
import { equipmentStatusLabel, approvalLabel, roleLabel } from '../utils/labels';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Avatar } from '../components/ui/AvatarStack';
import { SortableHeader } from '../components/ui/SortableHeader';
import { SmartSearch } from '../components/SmartSearch';
import { useSortableTable } from '../utils/useSortableTable';

type Tab = Extract<ResourceKind, 'people' | 'deliverables' | 'tangibles' | 'intangibles'> | 'search';
interface TabSpec {
  key: Tab;
  label: string;
  description: string;
}

/** Resource tabs surfaced to every signed-in user (read-only by default). */
const TABS: TabSpec[] = [
  { key: 'people', label: 'People', description: 'All team members, leads, and admins.' },
  {
    key: 'deliverables',
    label: 'Deliverables',
    // Deliverables are project-scoped — they can only be created from inside a
    // project. This tab is a read-only cross-project rollup; the inline hint
    // inside DeliverablesTab tells users where to go to add one.
    description: 'Cross-project rollup of work products. Read-only — open a project to add or edit deliverables.',
  },
  {
    key: 'tangibles',
    label: 'Tangibles',
    description: 'Physical assets you can carry, plug in, drive, or sit at — laptops, vehicles, monitors, rooms, anything else with a physical presence.',
  },
  {
    key: 'intangibles',
    label: 'Intangibles',
    description: 'Non-physical resources: software licenses, SaaS subscriptions, certifications, training credits, API quotas.',
  },
  {
    key: 'search',
    // Cross-resource lookup — searches names across deliverables,
    // allocations, tangibles, and intangibles in a single query with an
    // optional type filter. Mirrored on each project's detail page.
    label: 'Search',
    description: 'Smart name search across every resource type in the organisation.',
  },
];

/** Kind input is free-form — no autocomplete suggestions are surfaced. */

const EQUIPMENT_STATUSES: EquipmentStatus[] = ['available', 'in_use', 'maintenance', 'retired'];

/**
 * Resources hub. The project tracks five kinds of resource (people,
 * deliverables, tangibles, intangibles, budget); this page surfaces the
 * first four as tabs. Budget is project-scoped so it lives under each
 * project's detail.
 *
 * Tangibles and intangibles share the `equipment` table — distinguished by
 * the `is_tangible` flag added in migration 004 — so they reuse the same
 * `EquipmentTab` component, parameterised by `isTangible`.
 *
 * All signed-in roles may read every tab so team members and viewers can see
 * who's on the team and what's available. Writes follow per-tab RBAC
 * (re-enforced server-side in `backend/_lib/auth.py`).
 */
export function ResourcesPage() {
  const [tab, setTab] = useState<Tab>('people');
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Resources</h1>
        <p className="text-sm text-ink-500">
          Project resources by type. Budget is tracked per project — open a project to view it.
        </p>
      </header>

      <div role="tablist" aria-label="Resource type" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => {
          const selected = t.key === tab;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm ${selected ? 'border-b-2 border-brand-600 text-brand-700' : 'text-ink-500 hover:text-ink-900'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-ink-400">{TABS.find((t) => t.key === tab)?.description}</p>

      <div role="tabpanel">
        {tab === 'people' && <PeopleTab />}
        {tab === 'deliverables' && <DeliverablesTab />}
        {tab === 'tangibles' && <EquipmentTab isTangible={true} />}
        {tab === 'intangibles' && <EquipmentTab isTangible={false} />}
        {tab === 'search' && <SmartSearch />}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// People (allocatable users)
// ---------------------------------------------------------------------------

function PeopleTab() {
  const { apiGet } = useApi();
  const [rows, setRows] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<ListResponse<User>>('/resources-service')
      .then((res) => setRows(res.data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet]);

  // Sortable columns. Workload is sorted by the boolean flag so overworked
  // people bubble to the top when descending.
  const { sorted, sort, setSort } = useSortableTable(rows, {
    name:        (u) => u.full_name ?? '',
    email:       (u) => u.email,
    job_title:   (u) => u.job_title ?? '',
    role:        (u) => roleLabel(u.role),
    hours:       (u) => u.weekly_capacity_hours,
    projects:    (u) => u.active_project_count ?? -1,
    open_delivs: (u) => u.active_deliverable_count ?? -1,
    workload:    (u) => (u.is_overworked ? 1 : 0),
  }, { key: 'name', dir: 'asc' });

  return (
    <div className="overflow-x-auto rounded border border-line bg-surface">
      {loading && <p className="px-4 py-3 text-sm text-ink-400">Loading…</p>}
      {error && <p className="px-4 py-3 text-sm text-ember-500">{error}</p>}
      {!loading && !error && (
        <table className="min-w-full text-sm">
          <thead className="bg-surface-2 text-left text-ink-700">
            <tr>
              <SortableHeader sortKey="name"        sort={sort} setSort={setSort}>Name</SortableHeader>
              <SortableHeader sortKey="email"       sort={sort} setSort={setSort}>Email</SortableHeader>
              <SortableHeader sortKey="job_title"   sort={sort} setSort={setSort}>Job title</SortableHeader>
              <SortableHeader sortKey="role"        sort={sort} setSort={setSort}>Role</SortableHeader>
              <SortableHeader sortKey="hours"       sort={sort} setSort={setSort} align="right">Weekly hours</SortableHeader>
              <SortableHeader sortKey="projects"    sort={sort} setSort={setSort} align="right" title="Distinct projects with an approved allocation">Projects</SortableHeader>
              <SortableHeader sortKey="open_delivs" sort={sort} setSort={setSort} align="right" title="Open assignments (not yet completed) across all deliverables">Open deliverables</SortableHeader>
              <SortableHeader sortKey="workload"    sort={sort} setSort={setSort}>Workload</SortableHeader>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-5 text-ink-400">No allocatable users.</td></tr>
            )}
            {sorted.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <Avatar name={u.full_name} email={u.email} hueKey={u.id} size="sm" />
                    <span>{u.full_name || '—'}</span>
                  </span>
                </td>
                <td className="px-4 py-2.5">{u.email}</td>
                <td className="px-4 py-2.5">{u.job_title || '—'}</td>
                <td className="px-4 py-2.5"><span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{roleLabel(u.role)}</span></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{u.weekly_capacity_hours}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{u.active_project_count ?? '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{u.active_deliverable_count ?? '—'}</td>
                <td className="px-4 py-2.5">
                  {u.is_overworked
                    ? <OverworkBadge user={u} />
                    : <span className="text-xs text-ink-300">ok</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deliverables (cross-project read view)
// ---------------------------------------------------------------------------

function DeliverablesTab() {
  const { apiGet } = useApi();
  const [rows, setRows] = useState<Deliverable[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet<ListResponse<Deliverable>>('/deliverables-service?limit=100'),
      apiGet<ListResponse<Project>>('/projects-service?limit=100')
        .catch(() => ({ data: [] as Project[], meta: { total: 0, limit: 0, offset: 0 } })),
    ])
      .then(([res, projs]) => {
        setRows(res.data);
        setProjects(projs.data);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet]);

  const projectName = (id: string): string =>
    projects.find((p) => p.id === id)?.name ?? '';

  // Sort by project name (not id) so the "Project" column groups visibly.
  const { sorted, sort, setSort } = useSortableTable(rows, {
    title:   (d) => d.title,
    status:  (d) => d.status,
    due:     (d) => d.due_date ?? '',
    project: (d) => projectName(d.project_id),
  }, { key: 'title', dir: 'asc' });

  return (
    <div className="space-y-3">
      {/* Pointer to where deliverables actually get created — this tab is a
          read-only rollup, easy to mistake for a CRUD surface. */}
      <p className="rounded border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700">
        Deliverables live inside a project. To add or edit one, open a project
        from the <Link to="/projects" className="font-medium underline">Projects</Link> list and use the Deliverables section there.
      </p>
      <div className="overflow-x-auto rounded border border-line bg-surface">
        {loading && <p className="px-4 py-3 text-sm text-ink-400">Loading…</p>}
        {error && <p className="px-4 py-3 text-sm text-ember-500">{error}</p>}
        {!loading && !error && (
          <table className="min-w-full text-sm">
            <thead className="bg-surface-2 text-left text-ink-700">
              <tr>
                <SortableHeader sortKey="title"   sort={sort} setSort={setSort}>Title</SortableHeader>
                <SortableHeader sortKey="status"  sort={sort} setSort={setSort}>Status</SortableHeader>
                <SortableHeader sortKey="due"     sort={sort} setSort={setSort}>Due</SortableHeader>
                <SortableHeader sortKey="project" sort={sort} setSort={setSort}>Project</SortableHeader>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-5 text-ink-400">No deliverables yet — create one from a project page.</td></tr>
              )}
              {sorted.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="px-4 py-2.5">{d.title}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={d.status} /></td>
                  <td className="px-4 py-2.5">{d.due_date ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <Link to={`/projects/${d.project_id}`} className="text-brand-700 hover:underline">
                      {projectName(d.project_id) || 'Open'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

function EquipmentTab({ isTangible }: { isTangible: boolean }) {
  const { apiGet, apiPost, apiDelete } = useApi();
  const role = useRole();
  const canWrite = role === 'admin' || role === 'team_lead';
  const canSelfRequest = role === 'team_member';
  // Approval is intentionally **not** offered on this global page — every
  // tangible/intangible can only be accepted from inside the project it's
  // attached to (see ProjectEquipmentPanel). Showing approve/reject here
  // would let any lead rubber-stamp items on projects they don't own.
  const canDelete = role === 'admin';

  const noun = isTangible ? 'tangible' : 'intangible';
  const Noun = isTangible ? 'Tangible' : 'Intangible';

  const [rows, setRows] = useState<Equipment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState<EquipmentStatus>('available');
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    // is_tangible filter scopes the list to one tab. Projects are fetched
    // only to resolve assigned_project_id → project name in the read-only
    // "Project" column. Equipment is assigned to a project from inside the
    // project's own Resources panel, never from this page.
    Promise.all([
      apiGet<ListResponse<Equipment>>(`/equipment-service?is_tangible=${isTangible}&limit=100`),
      apiGet<ListResponse<Project>>('/projects-service?limit=100').catch(() => ({ data: [] as Project[], meta: { total: 0, limit: 0, offset: 0 } })),
    ])
      .then(([res, projs]) => {
        setRows(res.data);
        setProjects(projs.data);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet, isTangible]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Empty string → omit. Cost is a string in the form input so we send
      // it as a number when present. Equipment is created here unassigned;
      // attach it to a project from inside that project's Resources panel,
      // where the budget gate runs against the project's remaining budget.
      const body: Record<string, unknown> = {
        name: name.trim(),
        kind: kind.trim(),
        status,
        is_tangible: isTangible,
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
  const submitLabel = canSelfRequest ? 'Submit for approval' : 'Add';
  const projectById = (id: string | null): Project | undefined =>
    id ? projects.find((p) => p.id === id) : undefined;

  const { sorted, sort, setSort } = useSortableTable(rows, {
    name:     (e) => e.name,
    kind:     (e) => e.kind,
    status:   (e) => e.status,
    approval: (e) => e.approval_status,
    cost:     (e) => e.cost ?? -1,
    project:  (e) => projectById(e.assigned_project_id)?.name ?? '',
  }, { key: 'name', dir: 'asc' });

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-ember-500">{error}</p>}
      <div className="overflow-x-auto rounded border border-line bg-surface">
        {loading && <p className="px-4 py-3 text-sm text-ink-400">Loading…</p>}
        {!loading && (
          <table className="min-w-full text-sm">
            <thead className="bg-surface-2 text-left text-ink-700">
              <tr>
                <SortableHeader sortKey="name"     sort={sort} setSort={setSort}>Name</SortableHeader>
                <SortableHeader sortKey="kind"     sort={sort} setSort={setSort}>Kind</SortableHeader>
                <SortableHeader sortKey="status"   sort={sort} setSort={setSort}>Status</SortableHeader>
                <SortableHeader sortKey="approval" sort={sort} setSort={setSort}>Approval</SortableHeader>
                <SortableHeader sortKey="cost"     sort={sort} setSort={setSort} align="right">Cost</SortableHeader>
                <SortableHeader sortKey="project"  sort={sort} setSort={setSort}>Project</SortableHeader>
                {canDelete && <th scope="col" className="px-4 py-2.5 font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={canDelete ? 7 : 6} className="px-4 py-5 text-ink-400">
                  No {noun} resources recorded.
                </td></tr>
              )}
              {sorted.map((e) => {
                const pending = e.approval_status === 'pending';
                const rejected = e.approval_status === 'rejected';
                const badge = pending
                  ? 'bg-amber-100 text-amber-700'
                  : rejected
                    ? 'bg-ember-100 text-ember-700'
                    : 'bg-jade-100 text-jade-700';
                const proj = projectById(e.assigned_project_id);
                return (
                  <tr key={e.id} className="border-t border-line">
                    <td className="px-4 py-2.5">{e.name}</td>
                    <td className="px-4 py-2.5">{e.kind}</td>
                    <td className="px-4 py-2.5">{equipmentStatusLabel(e.status)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${badge}`}>{approvalLabel(e.approval_status)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {e.cost != null ? `${e.cost} ${e.currency}` : <span className="text-ink-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {proj ? (
                        <Link to={`/projects/${proj.id}`} className="text-brand-700 hover:underline">
                          {proj.name}
                        </Link>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                    {canDelete && (
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => void handleRemove(e.id)}
                            className="rounded border border-line-strong px-2 py-0.5 text-xs hover:bg-surface-2"
                          >
                            Remove
                          </button>
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

      {canCreate && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className={`flex flex-wrap items-start gap-2 rounded border border-dashed p-3 ${canSelfRequest ? 'border-amber-100 bg-amber-50' : 'border-line-strong'}`}
        >
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              canSelfRequest
                ? `Propose a ${noun} (e.g. ${isTangible ? 'MacBook Pro 14' : 'Figma seat'})…`
                : `${Noun} name (e.g. ${isTangible ? 'MacBook Pro 14' : 'Figma seat'})`
            }
            className="min-w-48 flex-[2_1_14rem] rounded border border-line-strong px-2 py-1.5 text-sm"
          />
          <input
            required
            maxLength={80}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder={`kind (free-form — e.g. ${isTangible ? 'laptop, forklift' : 'software_license, certification'})`}
            className="min-w-40 flex-1 rounded border border-line-strong px-2 py-1.5 text-sm"
            aria-label={`${Noun} kind`}
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as EquipmentStatus)}
            className="min-w-32 flex-none rounded border border-line-strong px-2 py-1.5 text-sm"
            aria-label={`${Noun} status`}
          >
            {EQUIPMENT_STATUSES.map((s) => <option key={s} value={s}>{equipmentStatusLabel(s)}</option>)}
          </select>
          <input
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="Cost"
            className="w-28 flex-none rounded border border-line-strong px-2 py-1.5 text-sm tabular-nums"
            aria-label="Cost"
          />
          <input
            type="text"
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="USD"
            className="w-20 flex-none rounded border border-line-strong px-2 py-1.5 text-sm uppercase"
            aria-label="Currency code"
            title="Three-letter currency code (USD, EUR, …)"
          />
          <button
            type="submit"
            disabled={submitting || !name.trim() || !kind.trim()}
            className={`w-full rounded px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${canSelfRequest ? 'bg-amber-600 hover:bg-amber-700' : 'bg-brand-600 hover:bg-brand-700'}`}
          >
            {submitLabel}
          </button>
        </form>
      )}
    </div>
  );
}


