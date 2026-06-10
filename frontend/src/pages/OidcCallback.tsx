import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';

/**
 * Cognito Hosted UI redirects here with ?code=&state=. `react-oidc-context`
 * processes the code automatically; once the user resolves we send them on.
 */
export function OidcCallback() {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [auth.isAuthenticated, navigate]);

  if (auth.error) {
    return <p className="p-8 text-sm text-red-600">Sign-in failed: {auth.error.message}</p>;
  }
  return <p className="p-8 text-sm text-gray-600">Completing sign-in…</p>;
}

