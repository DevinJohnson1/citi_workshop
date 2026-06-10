# Frontend
React 19 + Vite 7 + TypeScript 5 (strict) SPA. TailwindCSS 4 is the only
styling system; auth uses Cognito Hosted UI via `react-oidc-context`. See
`SYSTEM_DESIGN.md` section 4.1 and section 8.
## Quick start
```bash
cd frontend
npm install
npm run dev        # serves on :3000 (Vite); expects bin/proxy-server.js on :3001
```
For the full local stack (LocalStack + Postgres + proxy + Vite) run
`./bin/start-dev.sh` from the repo root instead -- it generates `.env.local`
from Terraform outputs first.
## Scripts
| Command           | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `npm run dev`     | Vite dev server on :3000 (HMR).                           |
| `npm run build`   | `tsc -b && vite build` -- type-check then bundle to dist/.|
| `npm run preview` | Serve the production build locally.                       |
| `npm run lint`    | ESLint flat config + typescript-eslint.                   |
| `npm run typecheck` | `tsc -b --noEmit`.                                      |
## Layout
```
src/
  main.tsx                # bootstrap + AuthProvider
  App.tsx                 # router + route guards
  index.css               # Tailwind v4 @import + design tokens (@theme)
  auth/
    oidcConfig.ts         # Cognito OIDC config (tokens in sessionStorage)
    ProtectedRoute.tsx    # route guard; bypassed when Cognito vars are empty
  components/
    AppShell.tsx          # responsive header + main + footer
  pages/                  # one per route (see SYSTEM_DESIGN section 8)
  services/
    apiClient.ts          # useApi() hook: apiGet/apiPost/apiPatch/apiDelete
  types/
    api.ts                # shared TS shapes matching the API schemas
```
## Env vars (written by `bin/generate-env.sh`)
| Variable                       | Notes                                       |
| ------------------------------ | ------------------------------------------- |
| `VITE_API_BASE_URL`            | `/api` on CloudFront, `http://localhost:3001/api` locally. |
| `VITE_COGNITO_AUTHORITY`       | Issuer URL. Empty on LocalStack -> auth is bypassed.       |
| `VITE_COGNITO_CLIENT_ID`       | App client ID.                              |
| `VITE_COGNITO_REDIRECT_URI`    | `https://<cf>/login/callback` or `http://localhost:3000/login/callback`. |
| `VITE_COGNITO_DOMAIN`          | Hosted UI domain prefix (optional).         |
Copy `.env.sample` to `.env.local` if you want to override any of these.
## Styling rules (section 8)
- Tailwind utilities only. No CSS modules, Emotion, or styled-components.
- Tokens (colors, spacing, font) live in `src/index.css` under `@theme`.
- Reusable visual patterns are React components that *compose* Tailwind
  internally -- do not pass `className` through unless documented.
- Behavior-bearing widgets (dialogs, menus, tabs) are hand-rolled in v1 and
  must include focus trap, Escape-to-dismiss, and WAI-ARIA keyboard nav.
  The ProjectDetailPage tab list is the reference implementation.
- For responsive show/hide use Tailwind (`hidden md:block`). For
  component-swap (drawer vs sidebar) use `react-responsive` `useMediaQuery`.
## Auth flow
1. User clicks a protected route. `ProtectedRoute` calls `auth.signinRedirect()`.
2. Cognito Hosted UI prompts; redirects back to `/login/callback?code=...`.
3. `react-oidc-context` exchanges the code; `OidcCallback` routes to `/dashboard`.
4. `useApi()` reads `auth.user.access_token` and injects it as `Bearer ...`.
5. Backend `_lib/auth.verify_token` checks `iss`, `aud`, `exp`, signature.
Local dev skips steps 1-3 because `VITE_COGNITO_*` are empty; the backend
still serves requests as a fixed dev admin (`IS_LOCAL=true`).
