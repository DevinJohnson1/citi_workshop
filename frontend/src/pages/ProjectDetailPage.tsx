import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApi } from '../services/apiClient';
import type { Project } from '../types/api';

type Tab = 'overview' | 'deliverables' | 'allocations' | 'budget';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'allocations', label: 'Allocations' },
  { key: 'budget', label: 'Budget' },
];

/**
 * Project detail with hand-rolled accessible tab navigation
 * (WAI-ARIA tabs pattern: arrow-key roving focus, `aria-selected`).
 */
export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const { apiGet } = useApi();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

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

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!project) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <p className="text-sm text-gray-600">Status: {project.status}</p>
      </header>

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
        {activeTab !== 'overview' && (
          <p className="text-gray-500">
            {activeTab} tab — implement against `/api/{activeTab === 'budget' ? 'budget-service' : `${activeTab}-service`}`.
          </p>
        )}
      </div>
    </section>
  );
}

