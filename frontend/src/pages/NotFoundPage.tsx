import { Link } from 'react-router-dom';

/** Catch-all route. CloudFront rewrites 404 → /index.html so deep links work. */
export function NotFoundPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-gray-600">
        The page you requested does not exist.{' '}
        <Link to="/" className="text-brand-700 hover:underline">Back home</Link>.
      </p>
    </section>
  );
}

