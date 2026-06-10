# bin/
Workflow scripts. Always invoke from the repo root (`./bin/<script>.sh`).
| Script                  | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `setup-environment.sh`  | One-time host install: Docker, AWS CLI, Terraform, LocalStack CLI. Pre-pulls the `postgres:17` and `localstack/localstack` docker images. **No native Postgres, no host `psql`, no LocalStack systemd unit** — Postgres and LocalStack run in containers (see `docker-compose.yml`), and `psql` is executed inside those containers by `migrate.sh`. |
| `setup-participant.sh`  | One-time AWS setup: account/role config + Terraform state bucket.    |
| `deploy-backend.sh [aws\|local]` | Rsyncs `backend/_lib/` into every service, then `terraform init` + `apply`. For `local`, points Terraform at LocalStack via `AWS_ENDPOINT_URL`. |
| `migrate.sh [aws\|local]`        | Applies every `backend/_db/migrations/*.sql` in lexical order. Runs `psql` **inside a container** (`docker compose exec postgres` for `local`, ephemeral `docker run --rm postgres:17` for `aws`), so the host needs no `psql` binary. Idempotent. |
| `deploy-frontend.sh [aws\|local]`| AWS: `npm run build` -> `s3 sync` -> CloudFront invalidation. Local: no-op.|
| `start-dev.sh`          | `docker compose up -d postgres localstack` (waits for health) -> `migrate.sh local` -> `deploy-backend.sh local` -> CORS proxy on :3001 -> Vite on :3000. |
| `generate-env.sh`       | Reads Terraform outputs and writes `frontend/.env.local` (API + Cognito vars).|
| `proxy-server.js`       | Node proxy that fans `/api/<svc>*` to Lambda Function URLs locally (works around a LocalStack CORS bug). |
| `cleanup-environment.sh`| `terraform destroy` followed by `docker compose down --volumes`.     |
## Typical sequences
```bash
# Local development — one command does everything
./bin/setup-environment.sh        # once per machine
./bin/start-dev.sh                # every session

# Or the manual breakdown
docker compose up -d postgres localstack
./bin/migrate.sh local
./bin/deploy-backend.sh local
(cd frontend && npm run dev)

# AWS workshop
./bin/setup-participant.sh
./bin/deploy-backend.sh aws
./bin/migrate.sh aws
./bin/deploy-frontend.sh aws
```
## Notes
- Postgres and LocalStack run as docker containers (`workshop-postgres`,
  `workshop-localstack`) on a shared user-defined network `coding-workshop`.
  LocalStack is configured with `LAMBDA_DOCKER_NETWORK=coding-workshop` so the
  Lambda containers it spawns reach Postgres by service name (`postgres:5432`).
- All scripts use `set -e`. If one fails, fix the root cause and re-run; they
  are designed to be idempotent.
- `migrate.sh aws` reads `rds_endpoint`/`rds_password` from Terraform outputs,
  so `deploy-backend.sh aws` must succeed first.
- `deploy-backend.sh` copies `backend/_lib/` into each `backend/<svc>/_lib/`
  before `terraform apply`. Those copies are gitignored.
- Override the dockerized Postgres credentials with `POSTGRES_USER` /
  `POSTGRES_PASS` / `POSTGRES_NAME`. Easiest way: `cp .env.example .env` and
  edit. Compose auto-loads `.env`; `start-dev.sh` seeds it from the example on
  first run.
- Ad-hoc queries: `docker compose exec postgres psql -U postgres` (no host
  `psql` install needed; the `postgres:17` image bundles the client).




