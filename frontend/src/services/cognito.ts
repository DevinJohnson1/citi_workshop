/**
 * Cognito InitiateAuth client. Calls the cognito-idp JSON-RPC endpoint
 * directly with the USER_PASSWORD_AUTH flow — no AWS SDK dependency, no
 * Hosted UI redirect. Works against both real AWS and LocalStack Pro.
 */

import { setSession, roleForEmail } from '../auth/session';

/**
 * Hard-coded list of the four legacy seed personas that the dev-auth bypass
 * applies to. Kept in lockstep with backend `_lib/auth.py:_DEV_BYPASS_EMAILS`.
 * The ACME roster is intentionally NOT bypassable — only the workshop accounts
 * that already share `WORKSHOP_PASSWORD` are eligible.
 */
const DEV_BYPASS_EMAILS: ReadonlySet<string> = new Set([
  'admin@workshop.local',
  'lead@workshop.local',
  'member@workshop.local',
  'viewer@workshop.local',
]);

/** True when the build was produced with VITE_DEV_AUTH_BYPASS=true. */
const DEV_BYPASS_ENABLED =
  String(import.meta.env.VITE_DEV_AUTH_BYPASS).toLowerCase() === 'true';

/** Shared workshop password the bypass requires. Baked into the JS bundle —
 * anyone who reads the bundle learns it. The backend independently verifies
 * the password against its own WORKSHOP_PASSWORD env var on every request,
 * so falsifying this constant in the bundle still won't get you in. */
const DEV_BYPASS_PASSWORD = String(import.meta.env.VITE_WORKSHOP_PASSWORD ?? '');

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
  const normalized = email.trim().toLowerCase();

  // Dev-auth bypass: skip cognito-idp entirely for the four legacy seed
  // personas when the build was produced with VITE_DEV_AUTH_BYPASS=true and
  // the backend Lambdas were deployed with AUTH_DEV_BYPASS=true. The bearer
  // token shape ("dev-bypass.<email>.<b64(password)>.<nonce>") is recognised
  // by `backend/_lib/auth.py:_verify_dev_bypass`, which compares the password
  // verbatim against its WORKSHOP_PASSWORD env var. The password is embedded
  // in plaintext (base64-encoded only to survive the dot separator) — anyone
  // who reads the bundle learns it. Treat as friction, not as security. See
  // SECURITY.md.
  if (DEV_BYPASS_ENABLED && DEV_BYPASS_EMAILS.has(normalized)) {
    // Client-side check for instant UX feedback. The backend re-checks the
    // same password against its WORKSHOP_PASSWORD env var on every request,
    // so this is the friendly-error path, not the security boundary.
    if (!DEV_BYPASS_PASSWORD || password !== DEV_BYPASS_PASSWORD) {
      throw new CognitoError('NotAuthorizedException', 'Incorrect email or password.');
    }
    const nonce =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // url-safe base64 of utf-8 password — matches Python's
    // base64.urlsafe_b64decode on the backend.
    const passwordB64 = btoa(
      Array.from(new TextEncoder().encode(password))
        .map((b) => String.fromCharCode(b))
        .join(''),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const token = `dev-bypass.${normalized}.${passwordB64}.${nonce}`;
    setSession({
      accessToken: token,
      idToken: token,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      email: normalized,
      role: roleForEmail(normalized),
    });
    return;
  }

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


