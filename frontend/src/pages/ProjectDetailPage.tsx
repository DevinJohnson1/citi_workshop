import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import { useCurrentUser } from '../auth/useCurrentUser';
import { DeliverablesPanel } from '../components/DeliverablesPanel';
import { AllocationsPanel } from '../components/AllocationsPanel';
import { BudgetPanel } from '../components/BudgetPanel';
import { ProjectEquipmentPanel } from '../components/ProjectEquipmentPanel';
import { SmartSearch } from '../components/SmartSearch';
import { StatusBadge } from '../components/ui/StatusBadge';
import { HealthStrip } from '../components/ui/HealthStrip';
import { prettyLabel } from '../utils/labels';
import type { Deliverable, Project, ProjectStatus, User } from '../types/api';

const PROJECT_STATUSES: ProjectStatus[] = ['planned', 'active', 'on_hold', 'done', 'cancelled'];

type Tab = 'overview' | 'deliverables' | 'allocations' | 'tangibles' | 'intangibles' | 'budget' | 'search';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'allocations', label: 'Allocations' },
  { key: 'tangibles', label: 'Tangibles' },
  { key: 'intangibles', label: 'Intangibles' },
  { key: 'budget', label: 'Budget' },
  { key: 'search', label: 'Search' },
];

/** Exact phrase the user must retype to confirm a destructive project delete. */
const DELETE_CONFIRMATION_PHRASE = 'DELETE';

/**
 * Project detail with hand-rolled accessible tab navigation
 * (WAI-ARIA tabs pattern: arrow-key roving focus, `aria-selected`).
 */
export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { apiGet, apiDelete, apiPatch, apiPost } = useApi();
  const currentUser = useCurrentUser();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  // Deliverables hydrate the header HealthStrip; failures are silent.
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  // Map of user_id → User, used to render `owner_id` as a real name in the
  // Overview pane rather than the raw UUID stored on the project row.
  const [usersById, setUsersById] = useState<Record<string, User>>({});
  const [claiming, setClaiming] = useState(false);
  // Inline status editor state — owners / co-leads / admins can change the
  // project status without leaving the page. Backend PATCH already accepts
  // the field; we just expose it.
  const [statusSaving, setStatusSaving] = useState(false);
  // Co-lead management state. `leadAddId` is the user_id selected in the
  // "Add co-lead" dropdown. `leadBusy` flips while a POST/DELETE is in
  // flight so we can disable the controls and avoid double-submits.
  const [leadAddId, setLeadAddId] = useState('');
  const [leadBusy, setLeadBusy] = useState(false);

  // Delete-confirmation state. `confirmOpen` toggles the inline panel;
  // `confirmText` mirrors the input and must equal DELETE_CONFIRMATION_PHRASE
  // before the destructive button enables. We intentionally do NOT use a
  // native window.confirm — a typed-phrase guard catches muscle-memory
  // double-clicks that a yes/no dialog does not.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiGet<Project>(`/projects-service/${id}`)
      .then(setProject)
      .catch((err: Error) => setError(err.message));
    apiGet<ListResponse<Deliverable>>(
      `/deliverables-service?project_id=${encodeURIComponent(id)}&limit=200`,
    )
      .then((r) => setDeliverables(r.data))
      .catch(() => setDeliverables([]));
    // Hydrate the user lookup so owner_id renders as a real name. Failures
    // are silent — the Overview pane falls back to the raw id.
    apiGet<ListResponse<User>>('/resources-service?limit=500')
      .then((r) => {
        const map: Record<string, User> = {};
        for (const u of r.data) map[u.id] = u;
        setUsersById(map);
      })
      .catch(() => setUsersById({}));
  }, [apiGet, id]);

  const handleTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = TABS.findIndex((t) => t.key === activeTab);
    if (idx < 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = TABS[(idx + 1) % TABS.length];
      if (next) setActiveTab(next.key);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = TABS[(idx - 1 + TABS.length) % TABS.length];
      if (prev) setActiveTab(prev.key);
    } else if (e.key === 'Home') {
      e.preventDefault();
      const first = TABS[0];
      if (first) setActiveTab(first.key);
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = TABS[TABS.length - 1];
      if (last) setActiveTab(last.key);
    }
  };

  /**
   * Issue the DELETE and bounce back to the projects list on success. The
   * backend uses a single `DELETE FROM projects` and relies on the FK
   * `ON DELETE CASCADE` declared in migration 001 to also remove every
   * attached deliverable and allocation atomically. The project's singular
   * `budget_amount` lives on the project row itself and disappears with it.
   */
  const handleDelete = async (): Promise<void> => {
    if (confirmText !== DELETE_CONFIRMATION_PHRASE || !project) return;
    setDeleting(true);
    setError(null);
    try {
      await apiDelete(`/projects-service/${project.id}`);
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
      setDeleting(false);
    }
  };

  // ---------------------------------------------------------------------
  // Derived values that depend on `project` / `usersById`.
  //
  // IMPORTANT: every `use*` hook below MUST run on every render, including
  // the initial render where `project === null`. They sit ABOVE the early
  // returns so the hook order is stable — otherwise React throws
  // "Rendered more hooks than during the previous render" and the page
  // goes blank. We tolerate `project === null` inside each memo and short
  // circuit to a safe default (empty arrays / `[ownerId]` etc).
  // ---------------------------------------------------------------------
  const leadIds = useMemo<string[]>(
    () => {
      if (!project) return [];
      return project.lead_ids && project.lead_ids.length > 0
        ? project.lead_ids
        : [project.owner_id];
    },
    [project],
  );
  const coLeadIds = useMemo<string[]>(
    () => (project ? leadIds.filter((id) => id !== project.owner_id) : []),
    [leadIds, project],
  );
  const eligibleCoLeads = useMemo<User[]>(
    () =>
      Object.values(usersById)
        .filter((u) => u.role === 'team_lead' && !leadIds.includes(u.id))
        .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email)),
    [usersById, leadIds],
  );

  if (error && !project) return <p className="rounded-md border border-ember-100 bg-ember-50 px-3 py-2 text-sm text-ember-700">{error}</p>;
  if (!project) return <p className="text-sm text-ink-400">Loading…</p>;

  // Mirrors backend authorisation in projects-service `_delete`: admin can
  // delete anything; a team_lead can delete only projects they own. We hide
  // the button for everyone else so the UI doesn't dangle a control that
  // would always 403. Delete stays *owner-only* even with co-leads — co-leads
  // must transfer ownership before they can wipe the project.
  const canDelete =
    !!currentUser &&
    (currentUser.role === 'admin' ||
      (currentUser.role === 'team_lead' && currentUser.id === project.owner_id));
  // Any project lead (owner or co-lead) may edit the project — drives the
  // status selector and the co-lead management strip. Mirrors the backend
  // `is_project_lead` check.
  const isProjectLead =
    !!currentUser &&
    currentUser.role === 'team_lead' &&
    leadIds.includes(currentUser.id);
  const canEditProject =
    !!currentUser && (currentUser.role === 'admin' || isProjectLead);
  // A team_lead who isn't already in the lead set can "claim" the project,
  // becoming its singular owner. The backend re-enforces that leads may
  // only ever set owner_id to themselves.
  const canClaim =
    !!currentUser &&
    currentUser.role === 'team_lead' &&
    !leadIds.includes(currentUser.id);
  // A team_lead who isn't already the owner can "claim" the project,
  // becoming its owner in addition to the original (the original owner
  // is replaced by the singular projects.owner_id column — the schema
  // doesn't support multi-owner — but any lead may step in as the
  // canonical owner without an admin round-trip). The backend re-enforces
  // the same rule in projects-service `_patch`.
  const owner = usersById[project.owner_id];
  const ownerLabel = owner
    ? owner.full_name || owner.email
    : project.owner_id;
  const confirmMatches = confirmText === DELETE_CONFIRMATION_PHRASE;

  /** PATCH owner_id to the current user, then refresh the project row. */
  const handleClaim = async (): Promise<void> => {
    if (!currentUser || !project) return;
    setClaiming(true);
    setError(null);
    try {
      const updated = await apiPatch<Project>(`/projects-service/${project.id}`, {
        owner_id: currentUser.id,
      });
      setProject(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setClaiming(false);
    }
  };

  /**
   * PATCH the project status. Backend accepts the field for any project
   * lead (owner OR co-lead) and for admins — see projects-service `_patch`.
   * On success we swap the local state so the StatusBadge updates without
   * a round-trip refetch.
   */
  const handleStatusChange = async (next: ProjectStatus): Promise<void> => {
    if (!project || next === project.status) return;
    setStatusSaving(true);
    setError(null);
    try {
      const updated = await apiPatch<Project>(`/projects-service/${project.id}`, {
        status: next,
      });
      setProject(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setStatusSaving(false);
    }
  };

  /**
   * Add a co-lead. The backend refuses anyone who isn't currently a
   * team_lead and refuses re-adding the canonical owner; we pre-filter the
   * dropdown so the user never sees an option that would 400.
   */
  const handleAddLead = async (): Promise<void> => {
    if (!project || !leadAddId) return;
    setLeadBusy(true);
    setError(null);
    try {
      await apiPost(`/projects-service/${project.id}/leads`, {
        user_id: leadAddId,
      });
      const refreshed = await apiGet<Project>(`/projects-service/${project.id}`);
      setProject(refreshed);
      setLeadAddId('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setLeadBusy(false);
    }
  };

  /** Remove a co-lead. The canonical owner is rejected by the backend. */
  const handleRemoveLead = async (userId: string): Promise<void> => {
    if (!project) return;
    setLeadBusy(true);
    setError(null);
    try {
      await apiDelete(`/projects-service/${project.id}/leads/${userId}`);
      const refreshed = await apiGet<Project>(`/projects-service/${project.id}`);
      setProject(refreshed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setLeadBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      {/* Breadcrumb */}
      <nav className="text-xs text-ink-500" aria-label="Breadcrumb">
        <Link to="/projects" className="hover:text-brand-700">Projects</Link>
        <span aria-hidden className="mx-1.5">/</span>
        <span className="text-ink-700">{project.name}</span>
      </nav>

      {/* Project hero — name, status, health pulse, delete affordance. */}
      <section className="overflow-hidden rounded-lg bg-surface shadow-card">
        <div className="px-5 pt-4">
          <HealthStrip deliverables={deliverables} project={project} height={6} />
        </div>
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <div className="label-caps">Project</div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
              {project.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-500">
              <StatusBadge status={project.status} />
              {project.is_at_risk && (
                <span className="rounded-full bg-ember-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-ember-700 ring-1 ring-inset ring-ember-100">
                  AT RISK
                </span>
              )}
              {project.target_end_date && (
                <span className="font-mono tnum">target {project.target_end_date}</span>
              )}
              {project.start_date && (
                <span className="font-mono tnum">started {project.start_date}</span>
              )}
            </div>
          </div>
          {canDelete && !confirmOpen && (
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(true);
                setConfirmText('');
                setError(null);
              }}
              className="rounded-md border border-ember-100 bg-surface px-3 py-1.5 text-sm font-medium text-ember-700 hover:bg-ember-50"
            >
              Delete project
            </button>
          )}
        </header>
      </section>

      {confirmOpen && (
        <div
          role="alertdialog"
          aria-labelledby="delete-project-title"
          aria-describedby="delete-project-desc"
          className="space-y-3 rounded-lg border border-ember-100 bg-ember-50/60 p-4 text-sm shadow-card"
        >
          <h2 id="delete-project-title" className="font-display text-base font-semibold text-ember-700">
            Delete this project?
          </h2>
          <p id="delete-project-desc" className="text-ember-700">
            This will permanently remove <strong>{project.name}</strong> and every
            deliverable and allocation attached to it, along with the
            project's budget ceiling. Equipment assignments will be cleared
            but the equipment itself is kept. This cannot be undone.
          </p>
          <label className="block">
            <span className="text-ember-700">
              Type <code className="rounded bg-ember-100 px-1 font-mono">{DELETE_CONFIRMATION_PHRASE}</code> to confirm:
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-label={`Type ${DELETE_CONFIRMATION_PHRASE} to confirm deletion`}
              className="mt-1 block w-full rounded-md border border-ember-100 bg-surface px-2 py-1.5 font-mono"
            />
          </label>
          {error && (
            <p role="alert" className="rounded-md border border-ember-100 bg-surface px-2 py-1 text-ember-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={!confirmMatches || deleting}
              className="rounded-md bg-ember-500 px-3 py-1.5 font-medium text-white hover:bg-ember-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(false);
                setConfirmText('');
                setError(null);
              }}
              disabled={deleting}
              className="rounded-md border border-line bg-surface px-3 py-1.5 hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div role="tablist" aria-label="Project sections" onKeyDown={handleTabKey} className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((tab) => {
          const selected = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              role="tab"
              type="button"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab.key)}
              className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors ${
                selected
                  ? 'border-brand-600 bg-surface text-brand-700'
                  : 'border-transparent text-ink-500 hover:text-ink-900'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="rounded-lg bg-surface p-4 text-sm shadow-card sm:p-5">
        {activeTab === 'overview' && (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
            <div>
              <dt className="label-caps">Description</dt>
              <dd className="mt-1 text-ink-900">{project.description || <span className="text-ink-400">—</span>}</dd>
            </div>
            <div>
              <dt className="label-caps">Owner</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2 text-ink-900">
                <span>{ownerLabel}</span>
                {owner?.role && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-ink-500">
                    {owner.role}
                  </span>
                )}
                {canClaim && (
                  <button
                    type="button"
                    onClick={() => void handleClaim()}
                    disabled={claiming}
                    className="rounded border border-line-strong px-2 py-0.5 text-xs hover:bg-surface-2 disabled:opacity-50"
                  >
                    {claiming ? 'Claiming…' : 'Claim ownership'}
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt className="label-caps">Start</dt>
              <dd className="mt-1 font-mono tnum text-ink-900">{project.start_date ?? <span className="text-ink-400 font-sans">—</span>}</dd>
            </div>
            <div>
              <dt className="label-caps">Target end</dt>
              <dd className="mt-1 font-mono tnum text-ink-900">{project.target_end_date ?? <span className="text-ink-400 font-sans">—</span>}</dd>
            </div>
            <div>
              <dt className="label-caps">Actual end</dt>
              <dd className="mt-1 font-mono tnum text-ink-900">{project.actual_end_date ?? <span className="text-ink-400 font-sans">—</span>}</dd>
            </div>
            <div>
              <dt className="label-caps">Updated</dt>
              <dd className="mt-1 font-mono tnum text-ink-900">{project.updated_at}</dd>
            </div>
            <div>
              <dt className="label-caps">Status</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                {canEditProject ? (
                  // Inline editor — backend PATCH /projects-service/{id}
                  // accepts `status` for any project lead (owner or
                  // co-lead) and for admins. Disabled while saving so we
                  // don't queue duplicate writes.
                  <>
                    <label className="sr-only" htmlFor="project-status">Project status</label>
                    <select
                      id="project-status"
                      value={project.status}
                      onChange={(e) => void handleStatusChange(e.target.value as ProjectStatus)}
                      disabled={statusSaving}
                      className="rounded border border-line-strong bg-surface px-2 py-1 text-sm disabled:opacity-50"
                    >
                      {PROJECT_STATUSES.map((s) => (
                        <option key={s} value={s}>{prettyLabel(s)}</option>
                      ))}
                    </select>
                    {statusSaving && <span className="text-xs text-ink-400">Saving…</span>}
                  </>
                ) : (
                  <StatusBadge status={project.status} />
                )}
              </dd>
            </div>
            {/* Co-leads — full row so the add/remove controls have room. */}
            <div className="md:col-span-2">
              <dt className="label-caps">Co-leads</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                {coLeadIds.length === 0 && (
                  <span className="text-ink-400">— no co-leads —</span>
                )}
                {coLeadIds.map((leadId) => {
                  const lead = usersById[leadId];
                  const label = lead ? lead.full_name || lead.email : leadId;
                  return (
                    <span
                      key={leadId}
                      className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-700"
                    >
                      {label}
                      {canEditProject && (
                        <button
                          type="button"
                          onClick={() => void handleRemoveLead(leadId)}
                          disabled={leadBusy}
                          aria-label={`Remove ${label} as co-lead`}
                          title="Remove co-lead"
                          className="ml-0.5 rounded text-ink-400 hover:text-ember-700 disabled:opacity-50"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  );
                })}
                {canEditProject && (
                  // Add-co-lead picker. Filtered to team_leads not already
                  // on the project (the backend rejects anything else with
                  // 400 — we suppress those options up-front).
                  <span className="inline-flex items-center gap-1">
                    <label className="sr-only" htmlFor="co-lead-add">Add co-lead</label>
                    <select
                      id="co-lead-add"
                      value={leadAddId}
                      onChange={(e) => setLeadAddId(e.target.value)}
                      disabled={leadBusy || eligibleCoLeads.length === 0}
                      className="rounded border border-line-strong bg-surface px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <option value="">
                        {eligibleCoLeads.length === 0 ? '— no eligible leads —' : '— add co-lead —'}
                      </option>
                      {eligibleCoLeads.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name || u.email}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleAddLead()}
                      disabled={leadBusy || !leadAddId}
                      className="rounded border border-line-strong px-2 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </span>
                )}
              </dd>
            </div>
          </dl>
        )}
        {activeTab === 'deliverables' && <DeliverablesPanel projectId={project.id} ownerId={project.owner_id} leadIds={leadIds} />}
        {activeTab === 'allocations' && <AllocationsPanel projectId={project.id} ownerId={project.owner_id} leadIds={leadIds} />}
        {activeTab === 'tangibles' && <ProjectEquipmentPanel projectId={project.id} ownerId={project.owner_id} leadIds={leadIds} isTangible={true} />}
        {activeTab === 'intangibles' && <ProjectEquipmentPanel projectId={project.id} ownerId={project.owner_id} leadIds={leadIds} isTangible={false} />}
        {activeTab === 'budget' && <BudgetPanel projectId={project.id} />}
        {activeTab === 'search' && <SmartSearch projectId={project.id} />}
      </div>
    </section>
  );
}
