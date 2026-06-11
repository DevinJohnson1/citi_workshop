import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite dev server config.
 *
 * Why every line of `server` matters:
 *
 * 1. **`port: 3000` + `strictPort: true`** — Vite's default behaviour when
 *    the requested port is busy is to silently increment (3000 → 3001 →
 *    3002 …). In this workshop `:3001` is owned by the Node CORS proxy
 *    (bin/proxy-server.js), so the silent bump lands the dev server on
 *    `:3002` or `:3003`, and every relative `/api/*` request the SPA fires
 *    then 404s. `strictPort: true` makes Vite fail loudly with a message
 *    naming the conflict so we fix the cause instead of chasing the
 *    symptom. To free :3000 quickly: `lsof -ti:3000 | xargs -r kill -9`
 *    (or run `npm run dev:reset`).
 *
 * 2. **`proxy`** — the SPA calls the backend through relative paths
 *    (`/api/<service>/…`, `/cognito`). The Vite dev server forwards them
 *    to the Node CORS proxy on `:3001` which in turn talks to LocalStack's
 *    Lambda Function URLs. With this in place the browser only ever sees
 *    one origin (`http://localhost:3000`), so:
 *
 *      - there is no CORS preflight on the SPA side
 *      - `.env.local` does NOT need to override `VITE_API_BASE_URL` for
 *        the dev loop (the default `/api` in `services/apiClient.ts` Just
 *        Works)
 *      - the OIDC redirect URI baked into `.env.local`
 *        (http://localhost:3000/login/callback) stays valid
 *
 *    `bin/generate-env.sh` still writes `VITE_API_BASE_URL=http://localhost:3001/api`
 *    for back-compat; this proxy makes that override redundant but harmless.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    proxy: {
      // /api/<service-name>/<path>  →  http://localhost:3001/api/<service-name>/<path>
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Cognito InitiateAuth — see bin/proxy-server.js for why this exists.
      '/cognito': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});



