import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getSession, homeForRole, type SessionRole } from './session';

interface Props {
  /** Element tree rendered when the user is authenticated and role-permitted. */
  children: ReactNode;
  /**
   * Optional role gate. Accepts a single role or a list. When set, the
   * current session's role must be included. UI gate only — the backend
   * re-enforces in `_lib/auth.py:require_role`.
   */
  requireRole?: SessionRole | SessionRole[];
}

/**
 * Route guard. Redirects:
 *   - unauthenticated users → `/login` (preserves original target)
 *   - authenticated-but-wrong-role users → their role's home page
 *     (`homeForRole`), so e.g. an admin who lands on `/dashboard` bounces
 *     to `/admin` rather than into a redirect loop.
 */
export function ProtectedRoute({ children, requireRole }: Props): ReactNode {
  const location = useLocation();
  const session = getSession();
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (requireRole) {
    const allowed = Array.isArray(requireRole) ? requireRole : [requireRole];
    if (!allowed.includes(session.role)) {
      return <Navigate to={homeForRole(session.role)} replace />;
    }
  }
  return children;
}

