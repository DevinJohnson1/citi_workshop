import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { ConditionalAuthProvider } from './auth/ConditionalAuthProvider';
import { initThemeClass } from './utils/theme';

// Apply the persisted (or OS-preferred) theme before first paint to avoid
// a light-to-dark flash on load.
initThemeClass();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element in index.html');
}

// ConditionalAuthProvider mounts <AuthProvider> on real AWS (https:// authority)
// and a passthrough fragment on LocalStack (http:// authority). This ensures:
//   - production: full OIDC Hosted UI flow works
//   - LocalStack:  no OIDC discovery request to real AWS (was causing 1-2 min delays)
createRoot(rootEl).render(
  <StrictMode>
    <ConditionalAuthProvider>
      <App />
    </ConditionalAuthProvider>
  </StrictMode>,
);

