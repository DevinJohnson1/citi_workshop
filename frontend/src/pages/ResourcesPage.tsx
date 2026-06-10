import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import { OverworkBadge } from '../components/OverworkBadge';
import type {
  ApprovalStatus,
  Deliverable,
  Equipment,
  EquipmentStatus,
  Project,
  ResourceKind,
  User,
} from '../types/api';

type Tab = Extract<ResourceKind, 'people' | 'deliverables' | 'tangibles' | 'intangibles'>;
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
        <p className="text-sm text-gray-600">
          Project resources by type. Budget is tracked per project — open a project to view it.
        </p>
      </header>

      <div role="tablist" aria-label="Resource type" className="flex flex-wrap gap-1 border-b border-gray-200">
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
              className={`px-3 py-2 text-sm ${selected ? 'border-b-2 border-brand-600 text-brand-700' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-gray-500">{TABS.find((t) => t.key === tab)?.description}</p>

      <div role="tabpanel">
        {tab === 'people' && <PeopleTab />}
        {tab === 'deliverables' && <DeliverablesTab />}
        {tab === 'tangibles' && <EquipmentTab isTangible={true} />}
        {tab === 'intangibles' && <EquipmentTab isTangible={false} />}
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

  return (
    <div className="overflow-x-auto rounded border border-gray-200 bg-white">
      {loading && <p className="px-3 py-2 text-sm text-gray-500">Loading…</p>}
      {error && <p className="px-3 py-2 text-sm text-red-600">{error}</p>}
      {!loading && !error && (
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-700">
            <tr>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">Email</th>
              <th scope="col" className="px-3 py-2">Job title</th>
              <th scope="col" className="px-3 py-2">Role</th>
              <th scope="col" className="px-3 py-2">Weekly hours</th>
              <th scope="col" className="px-3 py-2 text-right" title="Distinct projects with an approved allocation">Projects</th>
              <th scope="col" className="px-3 py-2 text-right" title="Open assignments (not yet completed) across all deliverables">Open deliverables</th>
              <th scope="col" className="px-3 py-2">Workload</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-4 text-gray-500">No allocatable users.</td></tr>
            )}
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  {u.full_name || '—'}
                </td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.job_title || '—'}</td>
                <td className="px-3 py-2"><span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{u.role}</span></td>
                <td className="px-3 py-2">{u.weekly_capacity_hours}</td>
                <td className="px-3 py-2 text-right tabular-nums">{u.active_project_count ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{u.active_deliverable_count ?? '—'}</td>
                <td className="px-3 py-2">
                  {u.is_overworked
                    ? <OverworkBadge user={u} />
                    : <span className="text-xs text-gray-400">ok</span>}
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<ListResponse<Deliverable>>('/deliverables-service?limit=100')
      .then((res) => setRows(res.data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet]);

  return (
    <div className="space-y-3">
      {/* Pointer to where deliverables actually get created — this tab is a
          read-only rollup, easy to mistake for a CRUD surface. */}
      <p className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        Deliverables live inside a project. To add or edit one, open a project
        from the <Link to="/projects" className="font-medium underline">Projects</Link> list and use the Deliverables section there.
      </p>
      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        {loading && <p className="px-3 py-2 text-sm text-gray-500">Loading…</p>}
        {error && <p className="px-3 py-2 text-sm text-red-600">{error}</p>}
        {!loading && !error && (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-700">
              <tr>
                <th scope="col" className="px-3 py-2">Title</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">Due</th>
                <th scope="col" className="px-3 py-2">Project</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-4 text-gray-500">No deliverables yet — create one from a project page.</td></tr>
              )}
              {rows.map((d) => (
                <tr key={d.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">{d.title}</td>
                  <td className="px-3 py-2">{d.status}</td>
                  <td className="px-3 py-2">{d.due_date ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Link to={`/projects/${d.project_id}`} className="text-brand-700 hover:underline">
                      Open
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
  const { apiGet, apiPost, apiPatch, apiDelete } = useApi();
  const role = useRole();
  const canWrite = role === 'admin' || role === 'team_lead';
  const canSelfRequest = role === 'team_member';
  const canApprove = canWrite;
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
  const submitLabel = canSelfRequest ? 'Submit for approval' : 'Add';
  const projectById = (id: string | null): Project | undefined =>
    id ? projects.find((p) => p.id === id) : undefined;

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
                <th scope="col" className="px-3 py-2">Cost</th>
                <th scope="col" className="px-3 py-2">Project</th>
                {(canApprove || canDelete) && <th scope="col" className="px-3 py-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={canApprove || canDelete ? 7 : 6} className="px-3 py-4 text-gray-500">
                  No {noun} resources recorded.
                </td></tr>
              )}
              {rows.map((e) => {
                const pending = e.approval_status === 'pending';
                const rejected = e.approval_status === 'rejected';
                const badge = pending
                  ? 'bg-amber-100 text-amber-800'
                  : rejected
                    ? 'bg-red-100 text-red-700'
                    : 'bg-emerald-100 text-emerald-800';
                const proj = projectById(e.assigned_project_id);
                return (
                  <tr key={e.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">{e.name}</td>
                    <td className="px-3 py-2">{e.kind}</td>
                    <td className="px-3 py-2">{e.status}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${badge}`}>{e.approval_status}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {e.cost != null ? `${e.cost} ${e.currency}` : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {proj ? (
                        <Link to={`/projects/${proj.id}`} className="text-brand-700 hover:underline">
                          {proj.name}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    {(canApprove || canDelete) && (
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
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => void handleRemove(e.id)}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
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

      {canCreate && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className={`flex flex-wrap items-start gap-2 rounded border border-dashed p-3 ${canSelfRequest ? 'border-amber-300 bg-amber-50' : 'border-gray-300'}`}
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
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="Cost"
            className="w-28 flex-none rounded border border-gray-300 px-2 py-1.5 text-sm tabular-nums"
            aria-label="Cost"
          />
          <input
            type="text"
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


