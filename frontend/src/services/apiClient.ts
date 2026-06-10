import { useMemo } from 'react';
import { useAuth } from 'react-oidc-context';
import { getAccessToken } from '../auth/session';
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
  apiPatch:  <T>(path: string, body: unknown) => Promise<T>;
  apiDelete: <T = void>(path: string) => Promise<T>;
}

/**
 * React hook returning a thin, typed `fetch` wrapper that injects the
 * Cognito access token. The workshop login flow stashes the token via
 * `auth/session.ts` (direct InitiateAuth); the OIDC user from
 * `react-oidc-context` is used as a fallback only on real AWS where the
 * Hosted UI is active (`isAuthConfigured = true`).
 *
 * On LocalStack `isAuthConfigured = false` and `<AuthProvider>` is not
 * mounted, so `useAuth()` returns an empty/null context (or throws).
 * The try-catch guards that case; `getAccessToken()` always takes priority
 * so the OIDC fallback is only reached in production.
 *
 * ## Identity stability (read before "optimising" this)
 *
 * The returned object is memoised on `token`, so `apiGet`/`apiPost`/etc.
 * keep referential identity across renders as long as the auth token
 * doesn't change. This matters because every consumer uses these
 * functions as `useEffect` / `useCallback` dependencies — without
 * memoisation, each parent re-render handed back fresh closures, which
 * re-fired every fetch on every render and produced visible
 * loading-spinner flicker (setLoading(true)→fetch→setLoading(false)
 * → render → new closure → fetch again, ad infinitum).
 *
 * If you ever add a new field to the returned object, include any value
 * it closes over in the `useMemo` dependency list — otherwise you'll
 * reintroduce stale-closure bugs (the new field would capture the first
 * render's value forever).
 */
export function useApi(): ApiClient {
  // useAuth() is always called to satisfy React's rules of hooks.
  // It is safe because ConditionalAuthProvider always mounts AuthProvider
  // when isAuthConfigured=true. When false (LocalStack), useAuth() may
  // return undefined or throw; we catch that and fall back to session.ts.
  let oidcAccessToken: string | undefined;
  try {
    const auth = useAuth();
    oidcAccessToken = isAuthConfigured ? (auth.user?.access_token ?? undefined) : undefined;
  } catch {
    // No AuthProvider context (LocalStack) — OIDC token not available.
    oidcAccessToken = undefined;
  }

  const token = getAccessToken() ?? oidcAccessToken;

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
     * names the URL we tried.
     */
    const doFetch = async <T,>(url: string, init: RequestInit): Promise<T> => {
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        throw new Error(`Network error calling ${init.method ?? 'GET'} ${url}: ${cause}`);
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

