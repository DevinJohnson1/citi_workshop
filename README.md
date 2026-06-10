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
## Local setup (Postgres + LocalStack in Docker)
Both Postgres and LocalStack run as containers defined in
[`docker-compose.yml`](./docker-compose.yml), attached to a shared
`coding-workshop` Docker network so Lambdas spawned by LocalStack reach
Postgres at hostname `postgres:5432` — no host-gateway IP juggling, no
`pg_hba.conf` edits, no native `postgresql` service to babysit.
```bash
# 1. One-time host install (Docker, AWS CLI, Terraform — no host psql needed)
./bin/setup-environment.sh
# 2. Bring up Postgres + LocalStack + backend + frontend (one command)
./bin/start-dev.sh
```
Or, if you want to run the pieces by hand:
```bash
cp .env.example .env                       # workshop-safe defaults; edit to taste
docker compose up -d postgres localstack   # start the containers
./bin/migrate.sh local                     # apply SQL migrations (psql runs in-container)
./bin/deploy-backend.sh local              # terraform apply against LocalStack
./bin/generate-env.sh && cd frontend && npm run dev
```
Ad-hoc SQL: `docker compose exec postgres psql -U postgres` — the host has no
`psql` binary; everything runs inside the `postgres:17` container.
Open <http://localhost:3000>. Auth is bypassed locally (`IS_LOCAL=true`); the
backend treats every request as a fixed dev admin user. See `SYSTEM_DESIGN.md`
§10 for why (LocalStack Cognito is a Pro feature).
Stop the local stack:
```bash
docker compose down            # keep volumes (data persists)
docker compose down --volumes  # nuke Postgres + LocalStack state
```
## AWS deployment (workshop)
```bash
./bin/setup-participant.sh             # one-time per AWS account/role
./bin/deploy-backend.sh aws            # terraform apply (RDS, Cognito, S3, CF, Lambdas)
./bin/migrate.sh aws                   # psql against the new Aurora cluster
./bin/deploy-frontend.sh aws           # vite build → s3 sync → CloudFront invalidate
```
`terraform output cloudfront_distribution_url` prints the live URL. Aurora's
first request after idle takes 15–30 s (`min_capacity=0`) — the landing page
shows a "warming up" indicator.
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
