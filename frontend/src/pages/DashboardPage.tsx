import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type ListResponse } from '../services/apiClient';
import type { Project } from '../types/api';

/** Lightweight dashboard summarising counts + at-risk projects. */
export function DashboardPage() {
  const { apiGet } = useApi();
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
        <Card title="Projects" value={projects?.length ?? '…'} to="/projects" />
        <Card title="At risk" value={atRisk?.length ?? '…'} to="/projects?at_risk=true" />
        <Card title="Reports" value="open" to="/reports" />
      </div>
    </section>
  );
}

interface CardProps {
  title: string;
  value: number | string;
  to: string;
}

function Card({ title, value, to }: CardProps) {
  return (
    <Link to={to} className="block rounded border border-gray-200 bg-white p-4 hover:border-brand-500">
      <div className="text-sm text-gray-600">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Link>
  );
}

