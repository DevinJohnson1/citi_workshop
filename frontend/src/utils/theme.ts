import { useCallback, useEffect, useState } from 'react';

/**
 * Theme utilities — light/dark colour scheme toggle.
 *
 * The scheme is applied by setting `data-theme="dark"` on the root `<html>`
 * element; matching CSS variable overrides in `index.css` swap the entire
 * Telemetry palette without any component-level conditionals.
 *
 * Resolution order on first paint:
 *   1. Explicit user choice persisted in `localStorage` (key below)
 *   2. The OS `prefers-color-scheme` media query
 *   3. Fallback to "light"
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'telemetry.theme';

/** Read the saved theme, falling back to the OS preference. */
export function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage blocked — fall through to media query. */
  }
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

/** Stamp the theme attribute onto `<html>` so CSS variables take effect. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

/**
 * React hook returning the active theme plus a toggle/setter pair.
 * Persists every explicit change to `localStorage`.
 */
export function useTheme(): {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
} {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* persistence is best-effort */
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}

