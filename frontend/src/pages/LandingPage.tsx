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
    <section className="space-y-8 py-6">
      <header className="space-y-3">
        <div className="label-caps">Internal · ACME Inc.</div>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
          Project Tracker
        </h1>
        <p className="max-w-prose text-base text-ink-500">
          Telemetry for every active engagement — health, deliverables,
          allocations, equipment and budget on one canvas. Built for the
          project managers who keep ACME shipping.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        {getSession() ? (
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-brand-700"
          >
            Go to dashboard <span aria-hidden>→</span>
          </Link>
        ) : (
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-brand-700"
          >
            Sign in <span aria-hidden>→</span>
          </Link>
        )}
        <a
          href="#health"
          className="inline-flex items-center rounded-md border border-line bg-surface px-4 py-2 text-sm text-ink-700 hover:bg-surface-2"
        >
          System status
        </a>
      </div>

      <div id="health" className="rounded-lg bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="label-caps">Backend health</div>
            <div className="mt-0.5 font-mono tnum text-sm text-ink-700">/projects-service/health</div>
          </div>
          <div className="text-sm">
            {state === 'loading' && (
              <span className="inline-flex items-center gap-1.5 text-ink-400">
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-300" />
                checking…
              </span>
            )}
            {state === 'warming' && (
              <span className="inline-flex items-center gap-1.5 text-amber-700">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                warming up — Aurora cold start can take 30 s
              </span>
            )}
            {state === 'ok' && (
              <span className="inline-flex items-center gap-1.5 text-jade-700">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-jade-500" />
                UP · <span className="font-mono tnum text-xs text-ink-500">{detail}</span>
              </span>
            )}
            {state === 'error' && (
              <span className="inline-flex items-center gap-1.5 text-ember-700">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ember-500" />
                unreachable · <span className="font-mono text-xs">{detail}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

