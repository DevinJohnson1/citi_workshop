/**
 * Cognito InitiateAuth client. Calls the cognito-idp JSON-RPC endpoint
 * directly with the USER_PASSWORD_AUTH flow — no AWS SDK dependency, no
 * Hosted UI redirect. Works against both real AWS and LocalStack Pro.
 */

import { setSession, roleForEmail } from '../auth/session';

interface AuthenticationResult {
  AccessToken: string;
  IdToken: string;
  RefreshToken?: string;
  ExpiresIn: number;
  TokenType: string;
}

interface InitiateAuthResponse {
  AuthenticationResult?: AuthenticationResult;
  ChallengeName?: string;
  Session?: string;
}

interface CognitoErrorBody {
  __type?: string;
  message?: string;
  Message?: string;
}

/** Thrown for any non-2xx response from cognito-idp. */
export class CognitoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Decode the `email` claim out of a Cognito ID token without verifying the
 * signature — the backend re-validates on every request, so we only need this
 * for UI display.
 */
function decodeEmail(idToken: string): string {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return '';
    const json = JSON.parse(
      decodeURIComponent(
        atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
          .split('')
          .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
          .join(''),
      ),
    ) as { email?: string };
    return json.email ?? '';
  } catch {
    return '';
  }
}

/**
 * Sign in with email + password and persist the resulting session.
 *
 * @throws {CognitoError} when Cognito rejects the credentials or is unreachable.
 */
export async function signIn(email: string, password: string): Promise<void> {
  const endpoint = import.meta.env.VITE_COGNITO_ENDPOINT as string | undefined;
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;
  if (!endpoint || !clientId) {
    throw new CognitoError(
      'ConfigurationError',
      'Cognito is not configured. Run ./bin/deploy-backend.sh and ./bin/generate-env.sh first.',
    );
  }

  const res = await fetch(`${endpoint.replace(/\/$/, '')}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: clientId,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  });

  if (!res.ok) {
    let body: CognitoErrorBody = {};
    try {
      body = (await res.json()) as CognitoErrorBody;
    } catch {
      /* non-JSON error — keep defaults */
    }
    const code = body.__type ?? `HTTP_${res.status}`;
    const message = body.message ?? body.Message ?? `Sign-in failed (${code})`;
    throw new CognitoError(code, message);
  }

  const data = (await res.json()) as InitiateAuthResponse;
  if (!data.AuthenticationResult) {
    throw new CognitoError(
      data.ChallengeName ?? 'UnexpectedChallenge',
      `Cognito returned an unexpected challenge (${data.ChallengeName ?? 'unknown'}).`,
    );
  }

  const auth = data.AuthenticationResult;
  const resolvedEmail = decodeEmail(auth.IdToken) || email;
  setSession({
    accessToken: auth.AccessToken,
    idToken: auth.IdToken,
    refreshToken: auth.RefreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + auth.ExpiresIn,
    email: resolvedEmail,
    // UI-only hint; backend re-derives the authoritative role per request.
    role: roleForEmail(resolvedEmail),
  });
}


