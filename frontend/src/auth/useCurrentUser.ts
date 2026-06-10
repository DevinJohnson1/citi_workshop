import { useEffect, useState } from 'react';
import { useApi } from '../services/apiClient';
import type { User } from '../types/api';
import { getSession, onSessionChange } from './session';

let cached: User | null = null;

/**
 * Fetch the caller's own `users` row from `/resources-service/me` and cache
 * it for the lifetime of the SPA session. Used by AllocationsPanel so a
 * team_member can self-request without needing to know their own user_id.
 *
 * The cache is invalidated on sign-out via `onSessionChange`.
 */
export function useCurrentUser(): User | null {
  const { apiGet } = useApi();
  const [user, setUser] = useState<User | null>(cached);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      cached = null;
      setUser(null);
      return;
    }
    if (cached) {
      setUser(cached);
      return;
    }
    apiGet<User>('/resources-service/me')
      .then((u) => {
        cached = u;
        setUser(u);
      })
      .catch(() => {
        cached = null;
        setUser(null);
      });
  }, [apiGet]);

  useEffect(
    () =>
      onSessionChange((s) => {
        if (!s) {
          cached = null;
          setUser(null);
        }
      }),
    [],
  );

  return user;
}

