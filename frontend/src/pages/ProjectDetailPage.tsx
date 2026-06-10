import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi, ApiError } from '../services/apiClient';
import { useCurrentUser } from '../auth/useCurrentUser';
import { DeliverablesPanel } from '../components/DeliverablesPanel';
import { AllocationsPanel } from '../components/AllocationsPanel';
import { BudgetPanel } from '../components/BudgetPanel';
import { ProjectEquipmentPanel } from '../components/ProjectEquipmentPanel';
import type { Project } from '../types/api';

type Tab = 'overview' | 'deliverables' | 'allocations' | 'tangibles' | 'intangibles' | 'budget';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'allocations', label: 'Allocations' },
  { key: 'tangibles', label: 'Tangibles' },
  { key: 'intangibles', label: 'Intangibles' },
  { key: 'budget', label: 'Budget' },
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
  const { apiGet, apiDelete } = useApi();
  const currentUser = useCurrentUser();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

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

  if (error && !project) return <p className="text-sm text-red-600">{error}</p>;
  if (!project) return <p className="text-sm text-gray-500">Loading…</p>;

  // Mirrors backend authorisation in projects-service `_delete`: admin can
  // delete anything; a team_lead can delete only projects they own. We hide
  // the button for everyone else so the UI doesn't dangle a control that
  // would always 403.
  const canDelete =
    !!currentUser &&
    (currentUser.role === 'admin' ||
      (currentUser.role === 'team_lead' && currentUser.id === project.owner_id));
  const confirmMatches = confirmText === DELETE_CONFIRMATION_PHRASE;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <p className="text-sm text-gray-600">Status: {project.status}</p>
        </div>
        {canDelete && !confirmOpen && (
          <button
            type="button"
            onClick={() => {
              setConfirmOpen(true);
              setConfirmText('');
              setError(null);
            }}
            className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
          >
            Delete project
          </button>
        )}
      </header>

      {confirmOpen && (
        <div
          role="alertdialog"
          aria-labelledby="delete-project-title"
          aria-describedby="delete-project-desc"
          className="space-y-3 rounded border border-red-300 bg-red-50 p-4 text-sm"
        >
          <h2 id="delete-project-title" className="font-semibold text-red-800">
            Delete this project?
          </h2>
          <p id="delete-project-desc" className="text-red-800">
            This will permanently remove <strong>{project.name}</strong> and every
            deliverable and allocation attached to it, along with the
            project's budget ceiling. Equipment assignments will be cleared
            but the equipment itself is kept. This cannot be undone.
          </p>
          <label className="block">
            <span className="text-red-800">
              Type <code className="rounded bg-red-100 px-1 font-mono">{DELETE_CONFIRMATION_PHRASE}</code> to confirm:
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-label={`Type ${DELETE_CONFIRMATION_PHRASE} to confirm deletion`}
              className="mt-1 block w-full rounded border border-red-300 px-2 py-1.5 font-mono"
            />
          </label>
          {error && (
            <p role="alert" className="rounded border border-red-300 bg-white px-2 py-1 text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={!confirmMatches || deleting}
              className="rounded bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
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
              className="rounded border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div role="tablist" aria-label="Project sections" onKeyDown={handleTabKey} className="flex gap-1 border-b border-gray-200">
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
              className={`px-3 py-2 text-sm ${selected ? 'border-b-2 border-brand-600 text-brand-700' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="rounded border border-gray-200 bg-white p-4 text-sm">
        {activeTab === 'overview' && (
          <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div><dt className="text-gray-500">Description</dt><dd>{project.description || '—'}</dd></div>
            <div><dt className="text-gray-500">Start</dt><dd>{project.start_date ?? '—'}</dd></div>
            <div><dt className="text-gray-500">Target end</dt><dd>{project.target_end_date ?? '—'}</dd></div>
            <div><dt className="text-gray-500">Actual end</dt><dd>{project.actual_end_date ?? '—'}</dd></div>
          </dl>
        )}
        {activeTab === 'deliverables' && <DeliverablesPanel projectId={project.id} />}
        {activeTab === 'allocations' && <AllocationsPanel projectId={project.id} />}
        {activeTab === 'tangibles' && <ProjectEquipmentPanel projectId={project.id} isTangible={true} />}
        {activeTab === 'intangibles' && <ProjectEquipmentPanel projectId={project.id} isTangible={false} />}
        {activeTab === 'budget' && <BudgetPanel projectId={project.id} />}
      </div>
    </section>
  );
}
