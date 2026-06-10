import type { ReactNode } from 'react';
import { AuthProvider } from 'react-oidc-context';
import { isAuthConfigured, oidcConfig } from './oidcConfig';

interface Props {
  children: ReactNode;
}

/**
 * Renders `<AuthProvider>` on real AWS (so `useAuth()` always has a context)
 * and a passthrough fragment on LocalStack (where OIDC is disabled).
 *
 * This prevents `oidc-client-ts` from fetching the OIDC discovery document
 * from the `VITE_COGNITO_AUTHORITY` URL on LocalStack. Previously that URL
 * was the AWS-format Cognito URL (`https://cognito-idp.…`) even in LocalStack;
 * the real AWS request failed slowly and caused 1–2 minute login delays.
 *
 * Now the LocalStack authority is `http://localhost.localstack.cloud:4566/…`
 * (http://) so `isAuthConfigured = false` and this component skips the provider.
 * The workshop login flow uses `session.ts` + direct `InitiateAuth` regardless.
 */
export function ConditionalAuthProvider({ children }: Props) {
  if (isAuthConfigured) {
    return <AuthProvider {...oidcConfig}>{children}</AuthProvider>;
  }
  // Fragment is intentional — it's the no-op wrapper when OIDC is disabled.
  return <>{children}</>;
}

