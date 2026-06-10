import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from 'react-oidc-context';
import './index.css';
import { App } from './App';
import { isAuthConfigured, oidcConfig } from './auth/oidcConfig';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element in index.html');
}

// When the Cognito env vars are missing we render without AuthProvider so
// silent renew doesn't spam errors. Note: the backend always enforces JWT
// verification (no dev-user fallback), so API calls will return 401 until
// auth is fully configured.
createRoot(rootEl).render(
  <StrictMode>
    {isAuthConfigured ? (
      <AuthProvider {...oidcConfig}>
        <App />
      </AuthProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
);

