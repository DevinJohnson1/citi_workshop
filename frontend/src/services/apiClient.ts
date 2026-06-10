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

/**
 * React hook returning a thin, typed `fetch` wrapper that injects the
 * Cognito access token. The workshop login flow stashes the token via
 * `auth/session.ts`; we also fall back to `react-oidc-context` for callers
 * that integrate Cognito's Hosted UI in production.
 */
export function useApi() {
  const auth = useAuth();
  // Prefer the workshop session (set by LoginPage); fall back to the OIDC
  // user when Hosted UI is wired up.
  const token = getAccessToken() ?? (isAuthConfigured ? auth.user?.access_token : undefined);

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

  return {
    /** GET `/<path>`. Path is appended verbatim to `VITE_API_BASE_URL`. */
    apiGet: <T>(path: string) =>
      fetch(`${BASE_URL}${path}`, { method: 'GET', headers: headers() }).then(handle<T>),
    /** POST `/<path>` with a JSON body. */
    apiPost: <T>(path: string, body: unknown) =>
      fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      }).then(handle<T>),
    /** PATCH `/<path>` with a JSON body. */
    apiPatch: <T>(path: string, body: unknown) =>
      fetch(`${BASE_URL}${path}`, {
        method: 'PATCH',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      }).then(handle<T>),
    /** DELETE `/<path>`. */
    apiDelete: <T = void>(path: string) =>
      fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: headers() }).then(handle<T>),
  };
}

