import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import type {
  ApprovalStatus,
  Deliverable,
  Equipment,
  EquipmentStatus,
  ResourceKind,
  User,
} from '../types/api';

type Tab = Extract<ResourceKind, 'people' | 'deliverables' | 'equipment'>;
interface TabSpec {
  key: Tab;
  label: string;
  description: string;
}

/** Resource tabs surfaced to every signed-in user (read-only by default). */
const TABS: TabSpec[] = [
  { key: 'people', label: 'People', description: 'All team members, leads, and admins.' },
  { key: 'deliverables', label: 'Deliverables', description: 'Work products across all projects.' },
  { key: 'equipment', label: 'Equipment', description: 'Tangible assets — any kind (laptops, vehicles, licenses, rooms, anything else you track).' },
];

/**
 * Common "seed" suggestions surfaced via a datalist. These are *hints*, not
 * constraints — the backend accepts any non-empty short label and the schema
 * has no CHECK constraint on `equipment.kind` (see migration 003).
 */
const COMMON_EQUIPMENT_KINDS = [
  'laptop',
  'vehicle',
  'license',
  'room',
  'monitor',
  'phone',
  'tablet',
  'camera',
  'tool',
  'other',
];

const EQUIPMENT_STATUSES: EquipmentStatus[] = ['available', 'in_use', 'maintenance', 'retired'];

/**
 * Resources hub. The project models four kinds of resource (people,
 * deliverables, equipment, budget); this page surfaces the first three as
 * tabs. Budget is project-scoped so it lives under each project's detail.
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
        {tab === 'equipment' && <EquipmentTab />}
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
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-gray-500">No allocatable users.</td></tr>
            )}
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="px-3 py-2">{u.full_name || '—'}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.job_title || '—'}</td>
                <td className="px-3 py-2"><span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{u.role}</span></td>
                <td className="px-3 py-2">{u.weekly_capacity_hours}</td>
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
              <tr><td colSpan={4} className="px-3 py-4 text-gray-500">No deliverables.</td></tr>
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
  );
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

function EquipmentTab() {
  const { apiGet, apiPost, apiPatch, apiDelete } = useApi();
  const role = useRole();
  const canWrite = role === 'admin' || role === 'team_lead';
  const canSelfRequest = role === 'team_member';
  const canApprove = canWrite;
  const canDelete = role === 'admin';

  const [rows, setRows] = useState<Equipment[]>([]);
  const [knownKinds, setKnownKinds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState<EquipmentStatus>('available');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<ListResponse<Equipment>>('/equipment-service?limit=100'),
      apiGet<{ data: string[] }>('/equipment-service/kinds').catch(() => ({ data: [] as string[] })),
    ])
      .then(([res, kinds]) => {
        setRows(res.data);
        // Merge historical kinds with the common-suggestion hints, dedupe + sort.
        const merged = Array.from(new Set([...kinds.data, ...COMMON_EQUIPMENT_KINDS])).sort();
        setKnownKinds(merged);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiGet]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiPost<Equipment>('/equipment-service', {
        name: name.trim(),
        kind: kind.trim(),
        status,
      });
      setName('');
      setKind('');
      setStatus('available');
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
                <th scope="col" className="px-3 py-2">Serial</th>
                {(canApprove || canDelete) && <th scope="col" className="px-3 py-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={canApprove || canDelete ? 6 : 5} className="px-3 py-4 text-gray-500">No equipment recorded.</td></tr>
              )}
              {rows.map((e) => {
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
                    <td className="px-3 py-2">{e.serial_number ?? '—'}</td>
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
          className={`grid grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-[1fr,160px,140px,auto] ${canSelfRequest ? 'border-amber-300 bg-amber-50' : 'border-gray-300'}`}
        >
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={canSelfRequest ? 'Propose an asset (e.g. MacBook Pro 14)…' : 'Equipment name (e.g. MacBook Pro 14)'}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            required
            list="equipment-kind-suggestions"
            maxLength={80}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder="kind (free-form — e.g. laptop, forklift, sw_license)"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            aria-label="Equipment kind"
          />
          <datalist id="equipment-kind-suggestions">
            {knownKinds.map((k) => <option key={k} value={k} />)}
          </datalist>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as EquipmentStatus)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            aria-label="Equipment status"
          >
            {EQUIPMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            type="submit"
            disabled={submitting || !name.trim() || !kind.trim()}
            className={`rounded px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${canSelfRequest ? 'bg-amber-600 hover:bg-amber-700' : 'bg-brand-600 hover:bg-brand-700'}`}
          >
            {submitLabel}
          </button>
        </form>
      )}
    </div>
  );
}


