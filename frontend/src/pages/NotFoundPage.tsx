import { Link } from 'react-router-dom';

/** Catch-all route. CloudFront rewrites 404 → /index.html so deep links work. */
export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-md space-y-4 py-12 text-center">
      <div className="label-caps">Error · 404</div>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
        Off the map.
      </h1>
      <p className="text-sm text-ink-500">
        The page you requested does not exist — it may have moved, or the link is wrong.
      </p>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-brand-700"
      >
        Back home <span aria-hidden>→</span>
      </Link>
    </section>
  );
}

