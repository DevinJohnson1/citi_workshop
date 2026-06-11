import { useMemo } from 'react';
import { useAuth } from 'react-oidc-context';
import { getIdToken } from '../auth/session';
import { isAuthConfigured } from '../auth/oidcConfig';

/** Base URL of the API gateway. Written by `bin/generate-env.sh`. */
const BASE_URL: string = import.meta.env.VITE_API_BASE_URL || '/api';

/** Error envelope returned by every backend handler (SYSTEM_DESIGN §7). */
export interface ApiErrorBody {
  error: string;
  message: string;
  timestamp: string;
}

/** Thrown by every `apiX` call on non-2xx responses. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** Typed list envelope for collection endpoints (SYSTEM_DESIGN §7). */
export interface ListResponse<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number };
}

/** Shape of the value returned by {@link useApi}. */
export interface ApiClient {
  apiGet:    <T>(path: string) => Promise<T>;
  apiPost:   <T>(path: string, body: unknown) => Promise<T>;
  apiPut:    <T>(path: string, body: unknown) => Promise<T>;
  apiPatch:  <T>(path: string, body: unknown) => Promise<T>;
  apiDelete: <T = void>(path: string) => Promise<T>;
}

/**
 * React hook returning a thin, typed `fetch` wrapper that injects the
 * Cognito **ID token** as the bearer credential.
 *
 * ## Why the ID token, not the access token
 *
 * The Cognito user pool is configured with `username_attributes=["email"]`
 * (`infra/cognito.tf`). In that mode access tokens carry only the internal
 * UUID — no `email` claim, no usable identifier for matching workshop
 * seed personas onto roles. The ID token carries `email` (and `aud` =
 * client id), so the backend can resolve the caller to a `users` row and
 * apply the right RBAC. See `backend/_lib/auth.py:verify_token` for the
 * full reasoning and the security trade-off.
 *
 * The workshop login flow (`services/cognito.ts`) puts both tokens into
 * `auth/session.ts`; we read the ID token via `getIdToken()`. On real AWS
 * with the Hosted UI active (`isAuthConfigured = true`), we fall back to
 * `auth.user?.id_token` from `react-oidc-context`.
 *
 * ## Identity stability (read before "optimising" this)
 *
 * The returned object is memoised on `token`, so `apiGet`/etc. keep
 * referential identity across renders as long as the auth token doesn't
 * change. Consumers use these functions as `useEffect` / `useCallback`
 * dependencies — without memoisation, each parent re-render handed back
 * fresh closures, which re-fired every fetch on every render and produced
 * visible loading-spinner flicker.
 */
export function useApi(): ApiClient {
  // useAuth() is always called to satisfy React's rules of hooks.
  // It is safe because ConditionalAuthProvider always mounts AuthProvider
  // when isAuthConfigured=true. When false (LocalStack), useAuth() may
  // return undefined or throw; we catch that and fall back to session.ts.
  let oidcIdToken: string | undefined;
  try {
    const auth = useAuth();
    oidcIdToken = isAuthConfigured ? (auth.user?.id_token ?? undefined) : undefined;
  } catch {
    // No AuthProvider context (LocalStack) — OIDC token not available.
    oidcIdToken = undefined;
  }

  const token = getIdToken() ?? oidcIdToken;

  return useMemo<ApiClient>(() => {
    /** Build standard headers; merges caller overrides last. */
    const headers = (extra: HeadersInit = {}): HeadersInit => {
      const h: Record<string, string> = { Accept: 'application/json', ...(extra as Record<string, string>) };
      if (token) h.Authorization = `Bearer ${token}`;
      return h;
    };

    /** Parse the response body, throwing `ApiError` on non-2xx. */
    const handle = async <T,>(res: Response): Promise<T> => {
      if (res.status === 204) return undefined as T;
      const isJson = (res.headers.get('content-type') ?? '').includes('json');
      const body = isJson ? await res.json() : null;
      if (!res.ok) {
        throw new ApiError(res.status, isJson ? (body as ApiErrorBody) : null);
      }
      return body as T;
    };

    /**
     * Run `fetch` and convert transport-layer `TypeError`s (the browser's
     * generic "Failed to fetch" — DNS failure, refused connection, CORS
     * preflight rejection, mid-flight socket close) into a message that
     * names the URL we tried AND tells the developer the most likely fix
     * in the dev loop, which is "the backend proxy on :3001 isn't up".
     */
    const doFetch = async <T,>(url: string, init: RequestInit): Promise<T> => {
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        const localHint = url.startsWith('/api') || url.includes('localhost:3001')
          ? ' — is the dev stack running? (run `bin/start-dev.sh` or check that the CORS proxy on :3001 is alive)'
          : '';
        throw new Error(
          `Network error calling ${init.method ?? 'GET'} ${url}: ${cause}${localHint}`,
          { cause: err },
        );
      }
      return handle<T>(res);
    };

    return {
      apiGet: <T>(path: string) =>
        doFetch<T>(`${BASE_URL}${path}`, { method: 'GET', headers: headers() }),
      apiPost: <T>(path: string, body: unknown) =>
        doFetch<T>(`${BASE_URL}${path}`, {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        }),
      apiPut: <T>(path: string, body: unknown) =>
        doFetch<T>(`${BASE_URL}${path}`, {
          method: 'PUT',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        }),
      apiPatch: <T>(path: string, body: unknown) =>
        doFetch<T>(`${BASE_URL}${path}`, {
          method: 'PATCH',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        }),
      apiDelete: <T = void>(path: string) =>
        doFetch<T>(`${BASE_URL}${path}`, { method: 'DELETE', headers: headers() }),
    };
  }, [token]);
}

