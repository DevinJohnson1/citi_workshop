/**
 * Tailwind v4 keeps configuration minimal — design tokens live in CSS via
 * `@theme` in `src/index.css`. This file exists so editors/IDEs that still
 * look for a config can find one; v4 ignores most fields here.
 *
 * See https://tailwindcss.com/blog/tailwindcss-v4 for the new model.
 */
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
};

export default config;

