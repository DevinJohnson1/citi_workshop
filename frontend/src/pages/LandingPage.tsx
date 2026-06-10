import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, ApiError } from '../services/apiClient';
import { getSession } from '../auth/session';

interface HealthResponse {
  status: string;
  db: string;
}

/** Public landing page — calls `/api/projects-service/health` to surface cold-start. */
export function LandingPage() {
  const { apiGet } = useApi();
  const [state, setState] = useState<'loading' | 'ok' | 'warming' | 'error'>('loading');
  const [detail, setDetail] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setState((s) => (s === 'loading' ? 'warming' : s));
    }, 3000);
    apiGet<HealthResponse>('/projects-service/health')
      .then((res) => {
        if (cancelled) return;
        setState('ok');
        setDetail(`status=${res.status}, db=${res.db}`);
      })
      .catch((err: ApiError) => {
        if (cancelled) return;
        setState('error');
        setDetail(err.message);
      })
      .finally(() => window.clearTimeout(slowTimer));
    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
    };
  }, [apiGet]);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">ACME Project Tracker</h1>
      <p className="text-gray-700 max-w-prose">
        Internal tool for tracking projects, deliverables, allocations, and budgets.
      </p>
      <div className="flex gap-3">
        {getSession() ? (
          <Link
            to="/dashboard"
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
          >
            Go to dashboard
          </Link>
        ) : (
          <Link
            to="/login"
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
          >
            Sign in
          </Link>
        )}
      </div>
      <div className="rounded border border-gray-200 bg-white p-4 text-sm">
        <span className="font-medium">Backend health:</span>{' '}
        {state === 'loading' && <span className="text-gray-500">checking…</span>}
        {state === 'warming' && (
          <span className="text-amber-600">warming up (Aurora cold start can take 30s)…</span>
        )}
        {state === 'ok' && <span className="text-emerald-600">UP — {detail}</span>}
        {state === 'error' && <span className="text-red-600">unreachable — {detail}</span>}
      </div>
    </section>
  );
}

