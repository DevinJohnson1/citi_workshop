import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getSession } from './session';

interface Props {
  /** Element tree rendered when the user is authenticated. */
  children: ReactNode;
  /** Optional role gate — if set, user must match. v1 stores role server-side; relax here. */
  requireRole?: string;
}

/**
 * Route guard: redirects unauthenticated users to the `/login` page,
 * preserving the original target in router state so we can bounce them back
 * after sign-in.
 */
export function ProtectedRoute({ children }: Props): ReactNode {
  const location = useLocation();
  const session = getSession();
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

