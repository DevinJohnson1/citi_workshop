import { useEffect, useState } from 'react';
import { getSession, onSessionChange, type SessionRole } from './session';

/**
 * React hook that returns the current session role (or `null` when signed
 * out) and re-renders the component on sign-in / sign-out. Use for UI
 * affordances only — backend re-checks authorization on every request.
 */
export function useRole(): SessionRole | null {
  const [role, setRole] = useState<SessionRole | null>(() => getSession()?.role ?? null);
  useEffect(() => onSessionChange((s) => setRole(s?.role ?? null)), []);
  return role;
}

/** Convenience: `true` when the caller holds any of the supplied roles. */
export function useHasRole(...roles: SessionRole[]): boolean {
  const role = useRole();
  return role !== null && roles.includes(role);
}

