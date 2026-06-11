import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signIn, CognitoError } from '../services/cognito';
import { getSession, homeForRole } from '../auth/session';
import { roleLabel } from '../utils/labels';

interface SeedPersona {
  email: string;
  role: string;
  label: string;
}

/**
 * Four canonical workshop personas — kept in lockstep with
 * `bin/seed-cognito.sh` and `backend/_lib/auth.py:_SEED_ROLES`.
 *
 * These accounts only exist in LocalStack and on dev pools. Production AWS
 * deployments skip them (see seed-cognito.sh `--aws` path) and set
 * `VITE_SEED_LOGIN_ENABLED=false` so the shortcut UI never appears.
 */
const SEED_USERS: SeedPersona[] = [
  { email: 'admin@workshop.local', role: 'admin', label: 'Admin' },
  { email: 'lead@workshop.local', role: 'team_lead', label: 'Team lead' },
  { email: 'member@workshop.local', role: 'team_member', label: 'Team member' },
  { email: 'viewer@workshop.local', role: 'viewer', label: 'Viewer' },
];

const SEED_PASSWORD = 'Workshop!2026';

/**
 * Whether to surface the quick-sign-in shortcut UI (persona buttons,
 * prefilled fields, shared-password footer). Defaults to **off** — a missing
 * or misconfigured env var must never accidentally expose the shortcut on a
 * real AWS deployment.
 */
const SEED_LOGIN_ENABLED =
  String(import.meta.env.VITE_SEED_LOGIN_ENABLED).toLowerCase() === 'true';

interface LocationState {
  from?: string;
}

/**
 * Username + password login page. Uses Cognito's USER_PASSWORD_AUTH flow via
 * `services/cognito.ts` — no Hosted UI redirect, so it works against
 * LocalStack Pro and real AWS without changes.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = (location.state as LocationState | null) ?? null;
  // `from` is set by ProtectedRoute when an unauthed user was redirected
  // away. If they were heading somewhere specific, honour it; otherwise
  // route to the role's natural home (viewers → /showcase, admins → /admin,
  // etc.) so we never dump anyone onto a page their role can't see.
  const returnTo = fromState?.from ?? null;
  const landingFor = (role: string | null | undefined): string =>
    returnTo ?? homeForRole(role as Parameters<typeof homeForRole>[0]);

  const [email, setEmail] = useState(SEED_LOGIN_ENABLED ? 'admin@workshop.local' : '');
  const [password, setPassword] = useState(SEED_LOGIN_ENABLED ? SEED_PASSWORD : '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Submit credentials, persist the session, and bounce to the original page. */
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate(landingFor(getSession()?.role), { replace: true });
    } catch (err) {
      if (err instanceof CognitoError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Sign-in failed for an unknown reason.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** One-click sign-in for a named seed persona. */
  const handlePersona = async (persona: SeedPersona): Promise<void> => {
    setEmail(persona.email);
    setPassword(SEED_PASSWORD);
    setSubmitting(true);
    setError(null);
    try {
      await signIn(persona.email, SEED_PASSWORD);
      navigate(landingFor(getSession()?.role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-md space-y-6">
      <header className="space-y-2 text-center">
        <div className="label-caps">Sign in</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">Welcome back.</h1>
        {SEED_LOGIN_ENABLED ? (
          <p className="text-sm text-ink-500">
            Use any of the four workshop personas — they were pre-seeded into
            Cognito by <code className="rounded bg-ink-200/40 px-1 font-mono text-[11px]">bin/seed-cognito.sh</code>.
          </p>
        ) : (
          <p className="text-sm text-ink-500">
            Sign in with your organisation credentials.
          </p>
        )}
      </header>

      {SEED_LOGIN_ENABLED && (
        <div className="grid grid-cols-2 gap-2">
          {SEED_USERS.map((p) => (
            <button
              key={p.email}
              type="button"
              disabled={submitting}
              onClick={() => void handlePersona(p)}
              className="group rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-sm shadow-card transition-shadow hover:border-brand-300 hover:shadow-pop disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink-900">{p.label}</span>
                <span className="rounded-full bg-ink-900 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-mist">
                  {roleLabel(p.role)}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-ink-400">{p.email}</div>
            </button>
          ))}
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 rounded-lg bg-surface p-5 shadow-card">
        <div>
          <label htmlFor="email" className="label-caps">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm focus:border-brand-500"
          />
        </div>
        <div>
          <label htmlFor="password" className="label-caps">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm focus:border-brand-500"
          />
        </div>
        {error && (
          <div role="alert" className="rounded-md border border-ember-100 bg-ember-50 px-3 py-2 text-sm text-ember-700">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-card hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {SEED_LOGIN_ENABLED && (
        <p className="text-center text-xs text-ink-400">
          Default password for all seed personas:{' '}
          <code className="rounded bg-ink-200/40 px-1 font-mono">{SEED_PASSWORD}</code>
        </p>
      )}
    </section>
  );
}

