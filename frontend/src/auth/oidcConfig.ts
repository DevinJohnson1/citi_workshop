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

/**
 * True only when running against real AWS Cognito (https:// authority).
 *
 * We must NOT mount `<AuthProvider>` on LocalStack because `oidc-client-ts`
 * would attempt to fetch the OIDC discovery document from the authority URL.
 * For LocalStack, `VITE_COGNITO_AUTHORITY` starts with `http://` (LocalStack
 * endpoint) so this flag is `false`, preventing the outbound request that
 * previously caused 1–2 minute login delays.
 *
 * The workshop login flow always uses `session.ts` + direct `InitiateAuth`
 * (cognito.ts) regardless of this flag. OIDC is only needed for the Hosted UI
 * redirect flow on real AWS.
 */
export const isAuthConfigured: boolean =
  Boolean(import.meta.env.VITE_COGNITO_AUTHORITY) &&
  Boolean(import.meta.env.VITE_COGNITO_CLIENT_ID) &&
  // Require https:// — LocalStack authority is http://, production is https://
  (import.meta.env.VITE_COGNITO_AUTHORITY as string).startsWith('https://');
