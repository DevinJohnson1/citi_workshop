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

/** Persisted session payload returned by Cognito InitiateAuth. */
export interface WorkshopSession {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  /** Epoch seconds (UTC) at which `accessToken` stops being valid. */
  expiresAt: number;
  /** Email claim copied out of the ID token for convenience in the UI. */
  email: string;
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

