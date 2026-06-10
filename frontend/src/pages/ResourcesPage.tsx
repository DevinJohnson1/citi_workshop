import { useEffect, useState } from 'react';
import { useApi, type ListResponse } from '../services/apiClient';
import type { User } from '../types/api';

/** Read-only listing of allocatable users. Admin edits are wired in v1.x. */
export function ResourcesPage() {
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
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Resources</h1>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-700">
              <tr>
                <th scope="col" className="px-3 py-2">Name</th>
                <th scope="col" className="px-3 py-2">Email</th>
                <th scope="col" className="px-3 py-2">Job title</th>
                <th scope="col" className="px-3 py-2">Weekly hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-4 text-gray-500">No allocatable users.</td></tr>
              )}
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">{u.full_name || '—'}</td>
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">{u.job_title || '—'}</td>
                  <td className="px-3 py-2">{u.weekly_capacity_hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

