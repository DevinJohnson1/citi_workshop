import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import type { Project } from '../types/api';

/**
 * Lightweight dashboard summarising counts + at-risk projects.
 *
 * Visible to team_lead, team_member, and viewer. Viewers see the same
 * counts but the Projects / At-risk cards render as plain tiles (not
 * `<Link>`s) because viewers are not allowed on `/projects` — letting
 * them click would bounce them back via `ProtectedRoute` redirect, which
 * is worse UX than not surfacing the link in the first place.
 */
export function DashboardPage() {
  const { apiGet } = useApi();
  const role = useRole();
  const canOpenProjects = role === 'team_lead' || role === 'team_member';
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [atRisk, setAtRisk] = useState<Project[] | null>(null);

  useEffect(() => {
    apiGet<ListResponse<Project>>('/projects-service?limit=100').then((r) => setProjects(r.data)).catch(() => setProjects([]));
    apiGet<{ data: Project[] }>('/reports-service/at-risk').then((r) => setAtRisk(r.data)).catch(() => setAtRisk([]));
  }, [apiGet]);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Projects" value={projects?.length ?? '…'} to={canOpenProjects ? '/projects' : null} />
        <Card title="At risk"  value={atRisk?.length   ?? '…'} to={canOpenProjects ? '/projects?at_risk=true' : null} />
        <Card title="Reports"  value="open"                    to="/reports" />
      </div>
    </section>
  );
}

interface CardProps {
  title: string;
  value: number | string;
  /** Null renders a non-clickable tile (for viewers who can't visit the target). */
  to: string | null;
}

function Card({ title, value, to }: CardProps) {
  const body = (
    <>
      <div className="text-sm text-gray-600">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </>
  );
  const baseClass = 'block rounded border border-gray-200 bg-white p-4';
  if (to === null) {
    return <div className={baseClass}>{body}</div>;
  }
  return (
    <Link to={to} className={`${baseClass} hover:border-brand-500`}>
      {body}
    </Link>
  );
}

