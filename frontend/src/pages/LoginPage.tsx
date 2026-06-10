import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signIn, CognitoError } from '../services/cognito';

interface SeedPersona {
  email: string;
  role: string;
  label: string;
}

/**
 * Four canonical workshop personas — kept in lockstep with
 * `bin/seed-cognito.sh` and `backend/_lib/auth.py:_SEED_ROLES`.
 */
const SEED_USERS: SeedPersona[] = [
  { email: 'admin@workshop.local', role: 'admin', label: 'Admin' },
  { email: 'lead@workshop.local', role: 'team_lead', label: 'Team lead' },
  { email: 'member@workshop.local', role: 'team_member', label: 'Team member' },
  { email: 'viewer@workshop.local', role: 'viewer', label: 'Viewer' },
];

const SEED_PASSWORD = 'Workshop!2026';

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
  const returnTo = fromState?.from ?? '/dashboard';

  const [email, setEmail] = useState('admin@workshop.local');
  const [password, setPassword] = useState(SEED_PASSWORD);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Submit credentials, persist the session, and bounce to the original page. */
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate(returnTo, { replace: true });
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
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-md space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-gray-600">
          Use any of the four workshop personas below — they were pre-seeded into
          Cognito by <code className="rounded bg-gray-100 px-1">bin/seed-cognito.sh</code>.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        {SEED_USERS.map((p) => (
          <button
            key={p.email}
            type="button"
            disabled={submitting}
            onClick={() => void handlePersona(p)}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-left text-sm shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="font-medium text-gray-900">{p.label}</div>
            <div className="text-xs text-gray-500">{p.email}</div>
            <div className="text-xs text-brand-700">role: {p.role}</div>
          </button>
        ))}
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 rounded border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        {error && (
          <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-xs text-gray-500">
        Default password for all seed personas: <code className="rounded bg-gray-100 px-1">{SEED_PASSWORD}</code>
      </p>
    </section>
  );
}

