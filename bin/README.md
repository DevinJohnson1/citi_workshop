# bin/

> **Spec:** these scripts implement the deployment model defined in
> [`../SYSTEM_DESIGN.md`](../SYSTEM_DESIGN.md) §10. Always invoke from the
> repo root (`./bin/<script>.sh`).

| Script                            | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `setup-environment.sh`            | One-time host install: Docker, AWS CLI, Terraform, LocalStack CLI. Pre-pulls the `postgres:17` and `localstack/localstack` docker images. **No native Postgres, no host `psql`** — the database is reached exclusively through the in-stack `migrate-service` Lambda.                                                                                                                                                                                                                                  |
| `setup-participant.sh`            | One-time AWS setup: account / role config + Terraform state bucket.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `deploy-backend.sh [aws\|local]`  | Rsyncs `backend/_lib/` into every service **and** `backend/_db/migrations/` into `backend/migrate-service/_migrations/`, then `terraform init` + `apply`. For `local`, points Terraform at LocalStack via `AWS_ENDPOINT_URL`. Automatically runs `migrate.sh "$ENVIRONMENT"` at the end.                                                                                                                                                                                                                |
| `migrate.sh [aws\|local]`         | Invokes the `migrate-service` Lambda via `aws lambda invoke` (LocalStack endpoint for `local`, real AWS for `aws`). The Lambda reads every bundled `_migrations/*.sql` and applies it in lex order, one transaction per file. No host `psql`, no host route to Postgres needed. Idempotent.                                                                                                                                                                                                            |
| `deploy-frontend.sh [aws\|local]` | AWS: `npm install` (if needed) → `vite build` → `s3 sync` → CloudFront invalidation. Local: no-op (use `start-dev.sh`).                                                                                                                                                                                                                                                                                                                                                                                |
| `start-dev.sh`                    | `docker compose up -d postgres localstack` (waits for health) → `deploy-backend.sh local` (which now also runs `migrate.sh local`) → CORS proxy on :3001 → Vite on :3000.                                                                                                                                                                                                                                                                                                                              |
| `seed-cognito.sh [aws\|local]`    | Idempotent Cognito user seed. `local` plants the four `@workshop.local` personas + 40 `@acme.org` roster; `aws` skips the four shared personas unless `SEED_INCLUDE_WORKSHOP=true` + a non-default `WORKSHOP_PASSWORD` are supplied.                                                                                                                                                                                                                                                                   |
| `generate-env.sh`                 | Reads Terraform outputs and writes `frontend/.env.local` (API + Cognito vars).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `proxy-server.js`                 | Node proxy that fans `/api/<svc>*` to Lambda Function URLs locally (works around a LocalStack CORS bug).                                                                                                                                                                                                                                                                                                                                                                                               |
| `cleanup-environment.sh`          | `terraform destroy` followed by `docker compose down --volumes`.                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Typical sequences

```bash
# Local development — one command does everything
./bin/setup-environment.sh        # once per machine
./bin/start-dev.sh                # every session

# Or the manual breakdown (deploy-backend.sh now runs migrations itself)
docker compose up -d postgres localstack
./bin/deploy-backend.sh local
(cd frontend && npm run dev)

# AWS workshop (deploy-backend.sh runs migrate.sh aws automatically at the end)
./bin/setup-participant.sh
./bin/deploy-backend.sh aws
./bin/seed-cognito.sh aws
./bin/generate-env.sh
./bin/deploy-frontend.sh aws

# Re-run migrations on their own (rare — usually deploy-backend.sh covers it)
./bin/migrate.sh aws              # or:  ./bin/migrate.sh local
```

## Notes

- **One migration path, two environments.** `migrate.sh` always invokes the
  in-stack `migrate-service` Lambda. Locally that Lambda runs inside
  LocalStack and reaches whichever Postgres the stack is using
  (LocalStack Aurora when `aws_postgres_enabled=true`, the
  `workshop-postgres` compose service otherwise). On real AWS the same
  Lambda runs inside the VPC alongside Aurora — so participants on VDIs,
  CloudShell, or laptops off the corporate VPN don't need any private
  route into the VPC to run migrations.
- **Bundling the SQL.** `deploy-backend.sh` rsyncs `backend/_db/migrations/`
  into `backend/migrate-service/_migrations/` right before `terraform apply`,
  so every `.sql` file ships inside the Lambda's deployment package. The
  generated `_migrations/` directory is gitignored — never edit it by hand.
- Postgres and LocalStack run as docker containers (`workshop-postgres`,
  `workshop-localstack`) on a shared user-defined network `coding-workshop`.
  LocalStack is configured with `LAMBDA_DOCKER_NETWORK=coding-workshop` so the
  Lambda containers it spawns reach Postgres by service name (`postgres:5432`).
- All scripts use `set -e`. If one fails, fix the root cause and re-run; they
  are designed to be idempotent.
- `deploy-backend.sh` copies `backend/_lib/` into each `backend/<svc>/_lib/`
  before `terraform apply`. Those copies are gitignored.
- Override the dockerized Postgres credentials with `POSTGRES_USER` /
  `POSTGRES_PASS` / `POSTGRES_NAME`. Easiest way: `cp .env.example .env` and
  edit. Compose auto-loads `.env`; `start-dev.sh` seeds it from the example on
  first run.
- Ad-hoc queries: `docker compose exec postgres psql -U postgres` (no host
  `psql` install needed; the `postgres:17` image bundles the client). On AWS,
  open a `psql` from inside the VPC (CloudShell-with-VPC, bastion, …) — the
  cluster is private by design.
