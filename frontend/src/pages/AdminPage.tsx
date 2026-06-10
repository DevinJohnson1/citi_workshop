import { Link } from 'react-router-dom';

/** Admin landing. Role check is enforced server-side; UI hides controls. */
export function AdminPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="text-sm text-gray-600">
        Manage users, roles, and resource flags. Backed by{' '}
        <code className="rounded bg-gray-100 px-1">/api/resources-service</code>.
      </p>
      <Link to="/resources" className="text-sm text-brand-700 hover:underline">
        → Go to resources
      </Link>
    </section>
  );
}

