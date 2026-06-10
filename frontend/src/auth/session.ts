/**
 * Lightweight in-browser session store for the workshop's username/password
 * Cognito login flow. Tokens live in `sessionStorage` (cleared when the tab
 * closes) per SYSTEM_DESIGN §4.1 — never `localStorage`.
 *
 * This intentionally sidesteps `react-oidc-context` because LocalStack's
 * Hosted UI is unreliable; the workshop relies on direct
 * `cognito-idp:InitiateAuth` calls from `services/cognito.ts` instead.
 */

const STORAGE_KEY = 'workshop.session';

/**
 * Coarse role taxonomy mirrored from `backend/_lib/auth.py:_SEED_ROLES` and
 * `frontend/src/types/api.ts:Role`. Duplicated here to avoid a circular import
 * (types/api.ts already imports nothing from auth/).
 */
export type SessionRole = 'admin' | 'team_lead' | 'team_member' | 'viewer';

/** Persisted session payload returned by Cognito InitiateAuth. */
export interface WorkshopSession {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  /** Epoch seconds (UTC) at which `accessToken` stops being valid. */
  expiresAt: number;
  /** Email claim copied out of the ID token for convenience in the UI. */
  email: string;
  /**
   * Best-effort role used **only** to drive UI affordances (hide nav, disable
   * buttons). All authorization is re-checked server-side in
   * `backend/_lib/auth.py`. Defaults to `'viewer'` for unknown users so the
   * UI fails closed.
   */
  role: SessionRole;
}

type Listener = (s: WorkshopSession | null) => void;
const listeners = new Set<Listener>();

/**
 * Subscribe to session changes. Returns an unsubscribe function. Useful for
 * components that need to re-render when sign-in/out happens in a sibling.
 */
export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read the currently persisted session, or `null` when signed out / expired. */
export function getSession(): WorkshopSession | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkshopSession;
    if (!parsed.accessToken || parsed.expiresAt * 1000 < Date.now()) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Persist a session and fan it out to subscribers. */
export function setSession(session: WorkshopSession): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  listeners.forEach((l) => l(session));
}

/** Clear the session (sign-out). */
export function clearSession(): void {
  window.sessionStorage.removeItem(STORAGE_KEY);
  listeners.forEach((l) => l(null));
}

/** Convenience: just the access token, or `null` when signed out. */
export function getAccessToken(): string | null {
  return getSession()?.accessToken ?? null;
}

/** Convenience: the caller's role, or `null` when signed out. */
export function getRole(): SessionRole | null {
  return getSession()?.role ?? null;
}

/**
 * Map the four canonical workshop personas to their seeded roles. Mirrors
 * `backend/_lib/auth.py:_SEED_ROLES` exactly. Anything else collapses to
 * `'viewer'` so unknown logins get the least-privileged UI.
 */
export function roleForEmail(email: string): SessionRole {
  switch (email.trim().toLowerCase()) {
    case 'admin@workshop.local':
      return 'admin';
    case 'lead@workshop.local':
      return 'team_lead';
    case 'member@workshop.local':
      return 'team_member';
    default:
      return 'viewer';
  }
}

/**
 * Per-role landing page. Used after login (default `returnTo`), by the
 * landing-page CTA, and by `ProtectedRoute` when redirecting a user away
 * from a page they don't have access to. Mirrors the route guard matrix in
 * `App.tsx`.
 *
 *   - admin       → `/admin` (the only page they ever interact with)
 *   - team_lead   → `/dashboard`
 *   - team_member → `/dashboard`
 *   - viewer      → `/reports` (their only allowed page)
 */
export function homeForRole(role: SessionRole | null | undefined): string {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'viewer':
      return '/reports';
    case 'team_lead':
    case 'team_member':
      return '/dashboard';
    default:
      return '/login';
  }
}

