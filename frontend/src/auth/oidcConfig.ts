import { WebStorageStateStore } from 'oidc-client-ts';
import type { AuthProviderProps } from 'react-oidc-context';

/**
 * Build the Cognito OIDC configuration consumed by `<AuthProvider>`.
 *
 * Tokens live in `sessionStorage` (never `localStorage`) per SYSTEM_DESIGN §4.1.
 * Silent renew is delegated to oidc-client-ts.
 */
export const oidcConfig: AuthProviderProps = {
  authority: import.meta.env.VITE_COGNITO_AUTHORITY,
  client_id: import.meta.env.VITE_COGNITO_CLIENT_ID,
  redirect_uri: import.meta.env.VITE_COGNITO_REDIRECT_URI,
  response_type: 'code',
  scope: 'openid profile email',
  automaticSilentRenew: true,
  loadUserInfo: false,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  // After login, strip ?code=&state= from the URL so a refresh doesn't replay it.
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, window.location.pathname);
  },
};

/** True when Cognito vars are wired (production). False on LocalStack. */
export const isAuthConfigured: boolean =
  Boolean(import.meta.env.VITE_COGNITO_AUTHORITY) &&
  Boolean(import.meta.env.VITE_COGNITO_CLIENT_ID);

