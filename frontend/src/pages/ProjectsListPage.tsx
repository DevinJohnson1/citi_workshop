import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type ListResponse } from '../services/apiClient';
import type { Project, ProjectStatus } from '../types/api';

const STATUSES: ProjectStatus[] = ['planned', 'active', 'on_hold', 'done', 'cancelled'];

/** Projects list — hand-rolled `<table>` with search, status filter, and at-risk toggle. */
export function ProjectsListPage() {
  const { apiGet } = useApi();
  const [rows, setRows] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ProjectStatus | ''>('');
  const [atRisk, setAtRisk] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
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

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Link
          to="/projects/new"
          className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          New project
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-sm">
          <span className="block text-gray-600">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="name contains…"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus | '')}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          >
            <option value="">any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm pt-5">
          <input type="checkbox" checked={atRisk} onChange={(e) => setAtRisk(e.target.checked)} />
          Only at-risk
        </label>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-700">
              <tr>
                <th scope="col" className="px-3 py-2">Name</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">Target end</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-4 text-gray-500">No projects.</td></tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link to={`/projects/${row.id}`} className="text-brand-700 hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">{row.target_end_date ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

