# ACME Project Tracker
Internal web app for ACME PMs to track projects, deliverables, resources, and
budgets. **Read [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) before touching code** —
it is the single source of truth for stack, schema, API, and deployment rules.
## Layout
| Directory                                            | What lives here                                | README                                       |
| ---------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| [`backend/`](./backend/README.md)                    | One Lambda per service + shared `_lib`         | [`backend/README.md`](./backend/README.md)   |
| [`backend/_db/migrations/`](./backend/_db/migrations)| Numbered SQL migrations (idempotent)           | n/a                                          |
| [`frontend/`](./frontend/README.md)                  | React 19 + Vite 7 + TypeScript SPA             | [`frontend/README.md`](./frontend/README.md) |
| [`infra/`](./infra/README.md)                        | Terraform: S3, CloudFront, Lambda, RDS, Cognito| [`infra/README.md`](./infra/README.md)       |
| [`bin/`](./bin/README.md)                            | Setup, deploy, dev, migrate scripts            | [`bin/README.md`](./bin/README.md)           |
| [`docs/`](./docs)                                    | Workshop notes (evaluation, testing, …)        | n/a                                          |
## Local setup (Aurora via LocalStack Pro)
By default the entire stack runs inside a single `localstack/localstack-pro`
container defined in [`docker-compose.yml`](./docker-compose.yml). Terraform
provisions an Aurora-PostgreSQL 17 cluster **inside** LocalStack — there is no
standalone Postgres container in the default path. A `postgres:17` fallback
container is gated behind a Compose profile for users running LocalStack
Community (no RDS support); pick the matching profile by setting
`TF_VAR_aws_postgres_enabled=false` and `COMPOSE_PROFILES=postgres`.
```bash
# 1. One-time host install (Docker, AWS CLI, Terraform — no host psql needed)
./bin/setup-environment.sh
# 2. Bring up LocalStack + provision Aurora + backend + frontend (one command)
./bin/start-dev.sh
```
Or, if you want to run the pieces by hand:
```bash
cp .env.example .env                       # set LOCALSTACK_AUTH_TOKEN for Pro
docker compose up -d localstack            # starts LocalStack (Aurora hosted inside it)
./bin/deploy-backend.sh local              # terraform apply (provisions Aurora + Lambdas)
./bin/migrate.sh local                     # apply SQL migrations to the Aurora cluster
./bin/seed-cognito.sh local                # plant the 4 personas + 40 ACME accounts
./bin/generate-env.sh                      # writes frontend/.env.local (incl. VITE_SEED_LOGIN_ENABLED=true)
cd frontend && npm run dev
```
Ad-hoc SQL against the live Aurora cluster: use `./bin/migrate.sh local --shell`
or read the Aurora endpoint from `terraform output rds_host_external` and dial
it with a host `psql`. The legacy `docker compose exec postgres psql` works
only on the Community fallback path.
Open <http://localhost:3000>. Sign in with any of the four workshop personas
using the quick-sign-in buttons on the login page (shared password
`Workshop!2026`, seeded by `bin/seed-cognito.sh`). The buttons are gated by
`VITE_SEED_LOGIN_ENABLED` — `true` on LocalStack, `false` on AWS.
Stop the local stack:
```bash
docker compose down            # keep volumes (data persists)
docker compose down --volumes  # nuke LocalStack state (Aurora data + Cognito pool)
```
## AWS deployment (workshop)
```bash
./bin/setup-participant.sh             # one-time per AWS account/role
./bin/deploy-backend.sh aws            # terraform apply (RDS, Cognito, S3, CF, Lambdas)
./bin/migrate.sh aws                   # psql against the new Aurora cluster
./bin/seed-cognito.sh aws              # seeds the 40 @acme.org roster ONLY
./bin/generate-env.sh                  # writes VITE_SEED_LOGIN_ENABLED=false
./bin/deploy-frontend.sh aws           # vite build → s3 sync → CloudFront invalidate
```
`terraform output cloudfront_distribution_url` prints the live URL. Aurora's
first request after idle takes 15–30 s (`min_capacity=0`) — the landing page
shows a "warming up" indicator.
### Login security on AWS
`bin/seed-cognito.sh aws` deliberately **skips** the four shared
`@workshop.local` test personas (they share `Workshop!2026` and exist only to
back the dev-loop quick-sign-in buttons). The 40 `@acme.org` roster accounts
each carry a unique 20-char alphanumeric password (~119 bits of entropy)
printed at the end of the run — save them to your password manager.
To force-seed the four shared personas on AWS (e.g. for a private demo pool)
you must also override the shared password:
```bash
WORKSHOP_PASSWORD='<strong-passphrase>' \
  SEED_INCLUDE_WORKSHOP=true \
  ./bin/seed-cognito.sh aws
```
The script refuses to plant `Workshop!2026` into a real Cognito pool.
On the frontend, `bin/generate-env.sh` writes `VITE_SEED_LOGIN_ENABLED=false`
for the AWS target, which hides the persona buttons, the prefilled email/
password fields, and the "default password" footer on `/login`. The
SPA falls back to a plain email + password form that only accepts the
roster accounts. To override per-deploy, export `VITE_SEED_LOGIN_ENABLED`
before running `generate-env.sh`.
## Tear-down
```bash
./bin/cleanup-environment.sh           # terraform destroy + docker compose down --volumes
```
## Rules at a glance
- **One Lambda per service** — `backend/<svc>/function.py`. Auto-discovered by `infra/locals.tf`.
- **No web framework on Lambda.** Dispatch on `event["requestContext"]["http"]["method"]` + `event["rawPath"]`.
- **All AWS resources via Terraform.** No ClickOps, no `aws … create-*`, no SDK provisioning. Drift = bug.
- **SQL is `psycopg` parameterized only.** No f-strings into SQL.
- **JWT verified in-handler.** Function URLs are `authorization_type=NONE`; the in-handler check is the only guard.

## Domain rules at a glance
- **Project access is allocation-gated.** A non-owning `team_lead` or
  `team_member` cannot add deliverables or resources to a project until they
  hold an *approved* `allocation` on it. They may always self-request an
  allocation (lands as `pending`); the owning lead approves it. Admins
  bypass.
- **Tangibles / intangibles can only be approved from within a project.**
  Approval (`approval_status` flip) is restricted to the owning lead of the
  item's `assigned_project_id`, or admin. The global resources page is
  read + delete only — no rubber-stamping from outside the project.
- **Deliverables form a per-project DAG.** The `depends_on` column is
  validated server-side: same-project only, no cycles (see
  `_validate_depends_on` in deliverables-service).
- **Overwork threshold = >5 open deliverable assignments** per user, surfaced
  on the People resources tab and the Reports overwork strip.
- **Five-project seed.** Migration `003_seed_acme_projects.sql` plants a
  realistic international-banking portfolio (3 large + 2 small projects,
  79 deliverables with mixed statuses, 33 equipment items, 73 dependency
  edges, 122 assignments, 32 allocations) so every report and chart
  renders something meaningful out of the box.

## UI conveniences
- **Light / dark mode toggle** in the Topbar — persists per-browser via
  `localStorage.telemetry.theme` and respects `prefers-color-scheme` on
  first load. The Showcase ("Big Picture") kiosk is intentionally fixed to
  its cinematic dark palette.
- **Sortable tables everywhere.** Every data table (People, Deliverables,
  Equipment, Allocations, Budget, Reports) ships with click-to-sort
  headers via the shared `useSortableTable` hook + `<SortableHeader/>`
  component. Null/empty values always sort last.
- **Initial-bubble avatars** for every signed-in user, hue-mapped from the
  email so the same person keeps the same colour everywhere.
Workshop docs: [`docs/`](./docs).
## CI security checks
Workflows under `.github/workflows/` run on every push and pull request:
| Workflow                 | Image / action                  | Scope                                        |
| ------------------------ | ------------------------------- | -------------------------------------------- |
| `python.actions.yml`     | `bandit`                        | Backend Python static analysis.              |
| `react.actions.yml`      | `npm audit`                     | Frontend dependency CVEs (high+).            |
| `terraform.actions.yml`  | `bridgecrewio/checkov-action`   | Terraform misconfiguration scan.             |
| `semgrep.actions.yml`    | `returntocorp/semgrep:latest`   | Multi-language SAST (security, OWASP, IaC).  |
| `gitleaks.actions.yml`   | `zricethezav/gitleaks:latest`   | Secret scanning across full git history.     |
Reproduce locally:
```bash
docker run --rm -v "$PWD:/src" returntocorp/semgrep:latest semgrep ci
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest \
    detect --source=/repo --config=/repo/.gitleaks.toml
```
Allow-listed false positives (workshop placeholders, LocalStack dummy creds)
live in `.gitleaks.toml` — extend it, don't disable the workflow.
## Dependency policy (Renovate)
`renovate.json` + `.github/workflows/renovate.actions.yml` configure Renovate
to open PRs **only when a HIGH or CRITICAL vulnerability is patched** in one
of our dependencies (npm, pip, Terraform providers, GitHub Actions, Docker).
Routine version bumps, lockfile maintenance, and LOW/MODERATE advisories are
suppressed so the PR queue stays focused on real security work.
To enable in a fork:
1. Either install the [Mend Renovate GitHub App](https://github.com/apps/renovate)
   on the repo (it will pick up `renovate.json` automatically) **or** create a
   `RENOVATE_TOKEN` secret with a PAT (repo + workflow scope) so the
   self-hosted workflow can run.
2. Confirm GitHub Dependabot alerts are turned on in Settings → Code security.
   Renovate reads severity from that graph.
