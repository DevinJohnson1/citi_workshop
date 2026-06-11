/**
 * Tailwind v4 keeps the source-of-truth for design tokens in CSS, inside the
 * `@theme { … }` block in `src/index.css`. This file mirrors a small subset
 * of those tokens so IDEs that still parse `tailwind.config.ts` (Tailwind
 * IntelliSense, ESLint plugins) can offer autocomplete; v4 itself ignores
 * the `theme` field at build time.
 *
 * Telemetry design system — see `src/index.css` for the canonical values.
 */
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mist: '#f5f7fb',
        surface: '#ffffff',
        'surface-2': '#f9fafc',
        line: '#e5e9f0',
        'line-strong': '#cbd2dd',
        ink: {
          200: '#c4cad6',
          300: '#9aa4b2',
          400: '#6b7588',
          500: '#475467',
          700: '#1f2a3d',
          900: '#0b1220',
        },
        brand: {
          50: '#eef2ff',
          100: '#dde4ff',
          300: '#8ea0f0',
          500: '#3957d6',
          600: '#1c3faa',
          700: '#16327f',
          800: '#112561',
        },
        jade:   { 50: '#e6f5f0', 100: '#c5e9dc', 500: '#0e7c66', 700: '#0a5a4a' },
        amber:  { 50: '#fdf3e1', 100: '#fbe6c3', 500: '#e89b2c', 700: '#a86b15' },
        ember:  { 50: '#fdecec', 100: '#fbd2d2', 500: '#d14343', 700: '#9b2828' },
        violet: { 50: '#f1ecfb', 100: '#e0d4f7', 500: '#6f3fd3', 700: '#4a268f' },
        sky:    { 50: '#e6f1fb', 100: '#c7dff5', 500: '#1f6fc0', 700: '#154d87' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11, 18, 32, 0.04), 0 0 0 1px rgba(11, 18, 32, 0.04)',
        pop:  '0 8px 24px -8px rgba(11, 18, 32, 0.18), 0 2px 6px rgba(11, 18, 32, 0.06)',
        focus:'0 0 0 3px rgba(28, 63, 170, 0.35)',
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '12px',
      },
    },
  },
};

export default config;



