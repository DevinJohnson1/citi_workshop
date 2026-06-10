import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, ApiError, type ListResponse } from '../services/apiClient';
import type { Project, ProjectStatus, User } from '../types/api';

const STATUSES: ProjectStatus[] = ['planned', 'active', 'on_hold', 'done', 'cancelled'];

/**
 * Project creation form. Available to `team_lead` and `admin` only — the
 * route is gated in `App.tsx` and the backend re-enforces the same role in
 * `projects-service`. The owner picker is populated from
 * `/resources-service` (allocatable users).
 */
export function ProjectCreatePage() {
  const { apiGet, apiPost } = useApi();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('planned');
  const [startDate, setStartDate] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [ownerId, setOwnerId] = useState('');

  const [owners, setOwners] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ListResponse<User>>('/resources-service')
      .then((res) => setOwners(res.data))
      .catch((err: Error) => setError(err.message));
  }, [apiGet]);

  /** Submit the form and bounce to the new project's detail page on success. */
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiPost<Project>('/projects-service', {
        name: name.trim(),
        description: description.trim(),
        status,
        start_date: startDate || null,
        target_end_date: targetEndDate || null,
        owner_id: ownerId || null,
      });
      navigate(`/projects/${created.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold">New project</h1>
        <p className="text-sm text-gray-600">
          As a team lead you own the project shell. Members can then create
          deliverables and budget entries inside it for your approval.
        </p>
      </header>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 rounded border border-gray-200 bg-white p-4">
        <label className="block text-sm">
          <span className="text-gray-700">Name</span>
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5"
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5"
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="text-gray-700">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-gray-700">Start date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="text-gray-700">Target end</span>
            <input
              type="date"
              value={targetEndDate}
              onChange={(e) => setTargetEndDate(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5"
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-gray-700">Owner (team lead)</span>
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5"
          >
            <option value="">— pick a member —</option>
            {owners.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.email} ({u.role})
              </option>
            ))}
          </select>
        </label>

        {error && (
          <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create project'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

