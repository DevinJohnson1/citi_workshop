#!/usr/bin/env bash
# Script: Local Development Environment Startup
# Purpose: Boot the full local stack — Postgres + LocalStack (both in Docker
#          via docker-compose.yml), apply DB migrations, deploy backend Lambdas
#          to LocalStack, start the CORS proxy, then hand off to Vite.
# Usage:   ./bin/start-dev.sh

set -e

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    cat <<'USAGE'
Usage: bin/start-dev.sh
Starts the local dev stack and the React dev server.

Steps:
  1. docker compose up -d postgres localstack   (waits for health)
  2. bin/deploy-backend.sh local                (terraform apply against LocalStack)
  3. bin/migrate.sh local                       (applies SQL migrations)
  4. bin/generate-env.sh + CORS proxy on :3001
  5. npm run dev                                (Vite on :3000)

Note: migrations run AFTER the backend deploy because in LocalStack Pro mode
the Aurora cluster is provisioned by Terraform — migrate.sh needs the
rds_endpoint_external output to exist. In Community mode the plain postgres
container is already up from step 1, so the order is harmless either way.

Requirements: docker (with compose plugin), terraform, node, npm.
            (psql is NOT required on the host — migrate.sh runs it inside the container.)
USAGE
    exit 0
fi

echo "==================================================="
echo "Local Development Environment Startup"
echo "==================================================="
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" >/dev/null 2>&1; pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1; pwd -P)"
INFRA_DIR="$PROJECT_ROOT/infra"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

# LocalStack endpoints — every aws/terraform invocation in this script targets
# the dockerized LocalStack on :4566.
# AWS_ENDPOINT_URL_S3 is required for Terraform ≥1.13: the S3 backend uses
# this variable (not the generic AWS_ENDPOINT_URL) for state GetObject/PutObject.
export AWS_ENDPOINT_URL="http://localhost:4566"
export AWS_ENDPOINT_URL_S3="http://s3.localhost.localstack.cloud:4566"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
unset AWS_SESSION_TOKEN

# ============================================================
# STEP 1: Start LocalStack (and optionally the fallback postgres container)
# ============================================================
echo "[1/5] Starting Docker containers..."

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is not installed (run bin/setup-environment.sh)"; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: docker daemon is not running"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: docker compose plugin is not installed"; exit 1; }
# Fail fast if node/npm are missing — steps 4 (CORS proxy) and 5 (Vite) need them.
command -v node >/dev/null 2>&1 || { echo "ERROR: node is not installed or not in PATH (needed by bin/proxy-server.js and Vite). Install Node.js 20+ and retry."; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: npm is not installed or not in PATH."; exit 1; }

cd "$PROJECT_ROOT"

# Auto-seed .env from .env.example on first run so `docker compose` picks up
# the workshop defaults (POSTGRES_USER, POSTGRES_PASS, ...). Participants can
# edit .env afterwards; we never overwrite an existing one.
if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
    echo "  ℹ Created .env from .env.example (edit it to override workshop defaults)"
fi

# Source .env so LOCALSTACK_IMAGE is readable in this shell process.
if [ -f .env ]; then
    set -a; . .env; set +a
fi

# ── Community vs Pro detection ──────────────────────────────────────────────
# LocalStack Pro supports Aurora RDS and Cognito. Community does not.
# Detect based on LOCALSTACK_IMAGE and propagate to Terraform vars so
# deploy-backend.sh (called in step 3) uses the right feature flags.
#
#   Pro  image → aws_postgres_enabled=true  (Aurora via LocalStack)
#   Community  → aws_postgres_enabled=false (plain postgres container)
#
# An explicit TF_VAR_aws_postgres_enabled in the environment takes priority.
LOCALSTACK_IMG="${LOCALSTACK_IMAGE:-localstack/localstack:latest}"
if [[ "$LOCALSTACK_IMG" == *pro* ]]; then
    export TF_VAR_aws_postgres_enabled="${TF_VAR_aws_postgres_enabled:-true}"
    export TF_VAR_enable_cognito="${TF_VAR_enable_cognito:-true}"
    POSTGRES_NEEDED=false
    echo "  ℹ LocalStack Pro — Aurora RDS + Cognito enabled"
else
    export TF_VAR_aws_postgres_enabled="${TF_VAR_aws_postgres_enabled:-false}"
    export TF_VAR_enable_cognito="${TF_VAR_enable_cognito:-false}"
    POSTGRES_NEEDED=true
    echo "  ℹ LocalStack Community — plain postgres container + Cognito disabled"
fi
# Allow explicit override to request postgres even on Pro (or suppress it on Community)
[ "${TF_VAR_aws_postgres_enabled}" = "false" ] && POSTGRES_NEEDED=true || true

# Build the docker compose command arguments.
# The postgres service uses `profiles: ["postgres"]` so it only starts when
# the profile is explicitly activated — preventing accidental starts.
if [ "$POSTGRES_NEEDED" = true ]; then
    COMPOSE_PROFILE_FLAG="--profile postgres"
    COMPOSE_SERVICES="localstack postgres"
else
    COMPOSE_PROFILE_FLAG=""
    COMPOSE_SERVICES="localstack"
fi

# `up -d --wait` blocks until every service with a healthcheck reports healthy
# (Compose v2.20+). Falls back to a manual poll loop on older versions.
# shellcheck disable=SC2086
if ! docker compose $COMPOSE_PROFILE_FLAG up -d --wait $COMPOSE_SERVICES 2>/tmp/compose.err; then
    echo "  ⚠ 'up -d --wait' not supported, falling back to manual readiness polling"
    # shellcheck disable=SC2086
    docker compose $COMPOSE_PROFILE_FLAG up -d $COMPOSE_SERVICES

    if [ "$POSTGRES_NEEDED" = true ]; then
        echo "  Waiting for Postgres..."
        for i in $(seq 1 30); do
            if docker compose exec -T postgres pg_isready -q -U postgres >/dev/null 2>&1; then
                break
            fi
            [ "$i" -eq 30 ] && { echo "  ✗ Postgres did not become healthy in 30s"; exit 1; }
            sleep 1
        done
    fi

    echo "  Waiting for LocalStack..."
    for i in $(seq 1 60); do
        if curl -sf http://localhost:4566/_localstack/health >/dev/null 2>&1; then
            break
        fi
        [ "$i" -eq 60 ] && { echo "  ✗ LocalStack did not become healthy in 60s"; exit 1; }
        sleep 1
    done
fi

if [ "$POSTGRES_NEEDED" = true ]; then
    echo "  ✓ postgres   → localhost:5432 (container: workshop-postgres)"
fi
echo "  ✓ localstack → localhost:4566 (container: workshop-localstack)"
echo ""

# ============================================================
# STEP 2: Deploy backend to LocalStack
# ============================================================
echo "[2/5] Deploying backend to LocalStack..."

# Install per-service pip requirements into each service dir. LocalStack's
# Lambda hot-reload mounts the service directory into the function container
# as-is (no build step, no zip), so the deps MUST be present on disk before
# the function is invoked — otherwise the import crashes with HTTP 502.
#
# These installs are LOCAL-DEV-ONLY. They are gitignored (see .gitignore
# `backend/*-service/<dep>/` block) and excluded from the AWS deploy zip via
# the `patterns` filter in infra/locals.tf — the Terraform Lambda module
# reinstalls everything fresh inside the SAM build image for AWS deploys.
#
# We run pip inside the official AWS SAM build image for python3.11 (the Lambda
# runtime) so the produced wheels are Linux/x86_64-compatible AND don't depend
# on the host Python version (host Pythons 3.13/3.14 cannot install psycopg
# binaries pinned to 3.11/3.12 wheel matrices).
shopt -s nullglob

# Always bundle backend/_lib/ into each service dir BEFORE we look at whether
# the backend is "already deployed" — without this, function.py crashes at
# import time inside the Lambda container with `ModuleNotFoundError: _lib`,
# which surfaces as a generic HTTP 502 from the Function URL.
LIB_SRC="$PROJECT_ROOT/backend/_lib"
if [ -d "$LIB_SRC" ] && command -v rsync >/dev/null 2>&1; then
    for svc in "$PROJECT_ROOT"/backend/*/function.py; do
        d="$(dirname "$svc")"
        case "$(basename "$d")" in _*) continue ;; esac
        rsync -a --delete "$LIB_SRC/" "$d/_lib/"
    done
fi

PIP_IMAGE="public.ecr.aws/sam/build-python3.11:latest"
for req in "$PROJECT_ROOT"/backend/*/requirements.txt; do
    svc_dir="$(dirname "$req")"
    [[ "$(basename "$svc_dir")" == _* ]] && continue
    REQS_HASH=$(md5sum "$req" 2>/dev/null | cut -d' ' -f1)
    HASH_FILE="$svc_dir/.pip_installed"

    # Skip when the manifest is unchanged since the last successful install.
    if [ "$(cat "$HASH_FILE" 2>/dev/null)" = "$REQS_HASH" ]; then
        continue
    fi

    # Manifest changed (or never installed). Do a CLEAN reinstall: wipe every
    # top-level entry in the service dir except the things we authored, then
    # let pip resolve the new set from scratch. This guarantees that any
    # package removed from requirements.txt — including its transitive deps
    # that no other package still pulls in — disappears from the service dir.
    # In-place `pip install --upgrade` would leave orphans behind because
    # pip --target has no garbage collector.
    #
    # The wipe runs INSIDE the same docker image as pip, because pip wrote
    # those files as root (container UID 0) into the bind mount; a host-side
    # `rm` would fail with EACCES. Same image → same UID → rm works.
    if compgen -G "$svc_dir/*.dist-info" >/dev/null 2>&1; then
        echo "  Pruning previous deps in $(basename "$svc_dir") before reinstall..."
        docker run --rm \
            -v "$svc_dir":/var/task \
            --entrypoint /bin/sh \
            "$PIP_IMAGE" \
            -c 'find /var/task -mindepth 1 -maxdepth 1 \
                  ! -name function.py \
                  ! -name requirements.txt \
                  ! -name _lib \
                  ! -name .pip_installed \
                  -exec rm -rf {} +' \
          || { echo "  ✗ prune failed for $(basename "$svc_dir")"; exit 1; }
    fi

    echo "  Installing pip requirements for $(basename "$svc_dir") (docker / python3.11)..."
    docker run --rm \
        -v "$svc_dir":/var/task \
        --entrypoint /bin/sh \
        "$PIP_IMAGE" \
        -c 'pip install --quiet --target=/var/task -r /var/task/requirements.txt' \
      || { echo "  ✗ pip install failed for $(basename "$svc_dir")"; exit 1; }
    echo "$REQS_HASH" > "$HASH_FILE"
done
shopt -u nullglob

cd "$INFRA_DIR"

PARTICIPANT_CONFIG="$PROJECT_ROOT/ENVIRONMENT.config"
[ -f "$PARTICIPANT_CONFIG" ] && source "$PARTICIPANT_CONFIG"

BUCKET_NAME="coding-workshop-tfstate-${PARTICIPANT_ID:-abcd1234}"
if ! aws s3 ls 2>/dev/null | grep -q "$BUCKET_NAME"; then
    echo "  Creating Terraform state bucket: $BUCKET_NAME"
    aws s3 mb "s3://$BUCKET_NAME" >/dev/null 2>&1 || {
        echo "  ✗ Failed to create Terraform state bucket"
        exit 1
    }
fi

terraform init -reconfigure \
    -backend-config="bucket=$BUCKET_NAME" \
    -backend-config="region=${AWS_REGION}" >/tmp/tf-init.log 2>&1 || {
    echo "  ✗ Terraform init failed:"
    tail -n 20 /tmp/tf-init.log | sed 's/^/    /'
    exit 1
}

SERVICES_ON_DISK=$(find "$PROJECT_ROOT/backend" -mindepth 2 -maxdepth 2 -name "function.py" -not -path "*/_*" | wc -l)
SERVICES_DEPLOYED=$(terraform output -json lambda_urls 2>/dev/null | grep -o 'http://[^"]*' | wc -l)

BACKEND_OK=false
if [ "$SERVICES_DEPLOYED" -ge "$SERVICES_ON_DISK" ] && [ "$SERVICES_DEPLOYED" -gt 0 ]; then
    LAMBDA_URL=$(terraform output -json lambda_urls 2>/dev/null | grep -o 'http://[^"]*' | head -1 || echo "")
    if [ -n "$LAMBDA_URL" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "$LAMBDA_URL" 2>/dev/null)" != "000" ]; then
        BACKEND_OK=true
        echo "  ✓ Backend already deployed ($SERVICES_DEPLOYED/$SERVICES_ON_DISK services)"
    fi
fi

if [ "$BACKEND_OK" = false ]; then
    echo "  Deploying backend..."
    "$SCRIPT_DIR/deploy-backend.sh" local >/tmp/backend-deploy.log 2>&1 || {
        echo "  ⚠ Backend deploy failed, restarting LocalStack and retrying..."
        cd "$PROJECT_ROOT"
        docker compose restart localstack
        for i in $(seq 1 60); do
            curl -sf http://localhost:4566/_localstack/health >/dev/null 2>&1 && break
            [ "$i" -eq 60 ] && { echo "  ✗ LocalStack failed to restart"; exit 1; }
            sleep 1
        done
        cd "$INFRA_DIR"
        "$SCRIPT_DIR/deploy-backend.sh" local >/tmp/backend-deploy.log 2>&1 || {
            echo "  ✗ Backend deploy failed after LocalStack restart"
            tail -n 50 /tmp/backend-deploy.log | sed 's/^/    /'
            exit 1
        }
    }
    echo "  ✓ Backend deployed"
fi

echo "  Lambda Function URLs:"
terraform output -json lambda_urls 2>/dev/null | grep -o 'http://[^"]*' | sed 's/^/    /' || echo "    (none)"
echo ""

# Seed the four workshop personas into Cognito (idempotent, no-op when Cognito
# isn't deployed e.g. on LocalStack Community with TF_VAR_enable_cognito=false).
"$SCRIPT_DIR/seed-cognito.sh" local || echo "  ⚠ Cognito seed step skipped/failed"
echo ""

# ============================================================
# STEP 3: Apply database migrations
# ============================================================
# Must run AFTER deploy-backend.sh so Aurora exists in Pro mode (the
# migrate script reads rds_endpoint_external from terraform outputs).
# In Community mode the plain workshop-postgres container is already up
# from step 1, so this ordering works for both flavours.
echo "[3/5] Applying database migrations..."
"$SCRIPT_DIR/migrate.sh" local
echo ""

# ============================================================
# STEP 4: CORS proxy
# ============================================================
echo "[4/5] Starting CORS proxy on :3001..."
cd "$FRONTEND_DIR"

"$SCRIPT_DIR/generate-env.sh" >/dev/null 2>&1 || echo "  ⚠ Could not generate .env.local"

if [ -f /tmp/proxy-server.pid ]; then
    kill "$(cat /tmp/proxy-server.pid)" 2>/dev/null || true
    rm -f /tmp/proxy-server.pid
fi
# Belt-and-braces: kill anything still bound to :3001 even when the pid file
# is stale (e.g. a previous run was started outside this script). Without
# this the next nohup fails with EADDRINUSE.
if lsof -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
    lsof -ti:3001 | xargs -r kill -9 2>/dev/null || true
    sleep 1
fi

nohup node "$SCRIPT_DIR/proxy-server.js" >/tmp/proxy-server.log 2>&1 &
PROXY_PID=$!
sleep 2
if kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "  ✓ Proxy server started (PID: $PROXY_PID)"
    echo "$PROXY_PID" > /tmp/proxy-server.pid
else
    echo "  ✗ Proxy server failed to start"
    if [ -s /tmp/proxy-server.log ]; then
        cat /tmp/proxy-server.log | sed 's/^/    /'
    else
        echo "    (no output captured — usually means 'node' could not be executed)"
        echo "    node: $(command -v node 2>/dev/null || echo 'NOT FOUND')"
    fi
    exit 1
fi
echo ""

# ============================================================
# STEP 5: Frontend (Vite)
# ============================================================
echo "[5/5] Starting Vite dev server on :3000..."

command -v npm >/dev/null 2>&1 || { echo "ERROR: npm is not installed"; exit 1; }

if [ ! -d node_modules ]; then
    echo "  Installing frontend dependencies..."
    rm -f package-lock.json
    npm install >/tmp/npm-install.log 2>&1 || {
        echo "  ✗ npm install failed"
        tail -n 30 /tmp/npm-install.log | sed 's/^/    /'
        exit 1
    }
fi

echo ""
echo "============================================================"
echo "  All services up"
echo "============================================================"
if [ "$POSTGRES_NEEDED" = true ]; then
    echo "  • postgres   → localhost:5432  (docker: workshop-postgres)"
else
    echo "  • aurora     → LocalStack Pro (ports 4510-4559)"
fi
echo "  • localstack → localhost:4566  (docker: workshop-localstack)"
echo "  • proxy      → http://localhost:3001"
echo "  • frontend   → http://localhost:3000"
echo ""
echo "  Stop the stack with:   docker compose down"
echo "  Press Ctrl+C to stop the Vite dev server."
echo ""

trap 'kill "$(cat /tmp/proxy-server.pid 2>/dev/null)" 2>/dev/null || true; rm -f /tmp/proxy-server.pid' EXIT

npm run dev


