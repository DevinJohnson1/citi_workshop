#!/usr/bin/env bash
# Script: Database Migration Runner
# Purpose: Apply every backend/_db/migrations/*.sql file in lexical order.
# Usage:   ./bin/migrate.sh [aws|local]
# Default: local
#
# Host has NO psql client. Migrations run via docker:
#   - local: `docker compose exec -T postgres psql ...` against the running
#            workshop-postgres container.
#   - aws:   `docker run --rm postgres:17 psql ...` (ephemeral container)
#            against the Aurora endpoint read from terraform outputs.
#
# Migrations are written to be idempotent (CREATE … IF NOT EXISTS, CREATE OR
# REPLACE TRIGGER, ALTER TABLE … ADD COLUMN IF NOT EXISTS), so running this
# repeatedly is safe.
set -euo pipefail
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    cat <<'USAGE'
Usage: bin/migrate.sh [aws|local]
Apply every backend/_db/migrations/*.sql file in lexical order against the
target Postgres instance.
  local   Local Postgres in Docker (default). Streams each SQL file into the
          `workshop-postgres` container via `docker compose exec`.
  aws     Reads endpoint/credentials from terraform outputs in infra/, then
          runs psql inside an ephemeral `postgres:17` container against Aurora.
Requirements: docker (with compose plugin). Terraform too for the aws target.
USAGE
    exit 0
fi
echo "================================="
echo "ACME Project Tracker - Migrations"
echo "================================="
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is missing"; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: docker daemon is not running"; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
MIGRATIONS_DIR="$PROJECT_ROOT/backend/_db/migrations"
TARGET="${1:-local}"
shopt -s nullglob
files=( "$MIGRATIONS_DIR"/*.sql )
if [ ${#files[@]} -eq 0 ]; then
    echo "WARNING: no .sql files found in $MIGRATIONS_DIR"
    exit 0
fi
# run_psql_file <path-to-sql>
# Streams the file on stdin into a psql process. The transport (compose exec
# vs ephemeral container) is decided once per invocation based on $TARGET.
if [ "$TARGET" = "aws" ]; then
    command -v terraform >/dev/null 2>&1 || { echo "ERROR: terraform is missing"; exit 1; }
    pushd "$PROJECT_ROOT/infra" >/dev/null
    PGHOST="$(terraform output -raw rds_endpoint_external 2>/dev/null || true)"
    PGPORT="$(terraform output -raw rds_port 2>/dev/null || echo 5432)"
    PGDATABASE="$(terraform output -raw rds_database 2>/dev/null || echo postgres)"
    PGUSER="$(terraform output -raw rds_username 2>/dev/null || echo superadmin)"
    PGPASSWORD="$(terraform output -raw rds_password 2>/dev/null || true)"
    popd >/dev/null
    if [ -z "$PGHOST" ] || [ -z "$PGPASSWORD" ]; then
        echo "ERROR: could not read RDS connection details from terraform outputs."
        echo "       Make sure ./bin/deploy-backend.sh aws ran successfully."
        exit 1
    fi
    echo "INFO: target=aws host=$PGHOST db=$PGDATABASE user=$PGUSER (psql via ephemeral postgres:17 container)"
    run_psql_file() {
        docker run --rm -i \
            -e PGPASSWORD="$PGPASSWORD" \
            postgres:17 \
            psql --quiet --set ON_ERROR_STOP=on \
                 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
                 < "$1"
    }
else
    # Local target: detect whether Aurora is deployed in LocalStack (the default
    # when aws_postgres_enabled=true) or whether we should fall back to the plain
    # postgres Docker container (aws_postgres_enabled=false / LocalStack Community).
    AURORA_ENABLED=false
    if command -v terraform >/dev/null 2>&1 && pushd "$PROJECT_ROOT/infra" >/dev/null 2>&1; then
        # Point Terraform at LocalStack. AWS_ENDPOINT_URL_S3 is required for
        # Terraform ≥1.13: the S3 backend uses this variable (not the generic
        # AWS_ENDPOINT_URL) for its own state GetObject/PutObject calls.
        _LS_ENV="AWS_ENDPOINT_URL=http://localhost:4566 AWS_ENDPOINT_URL_S3=http://s3.localhost.localstack.cloud:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1"
        PGHOST="$(eval "$_LS_ENV terraform output -raw rds_endpoint_external 2>/dev/null" || echo "")"
        PGPORT="$(eval "$_LS_ENV terraform output -raw rds_port 2>/dev/null" || echo "")"
        PGDATABASE="$(eval "$_LS_ENV terraform output -raw rds_database 2>/dev/null" || echo "")"
        PGUSER="$(eval "$_LS_ENV terraform output -raw rds_username 2>/dev/null" || echo "")"
        PGPASSWORD="$(eval "$_LS_ENV terraform output -raw rds_password 2>/dev/null" || echo "")"
        popd >/dev/null 2>&1
        [ -n "$PGHOST" ] && [ -n "$PGPASSWORD" ] && AURORA_ENABLED=true
    fi

    if [ "$AURORA_ENABLED" = true ]; then
        # Aurora in LocalStack. Ports 4510-4559 are published to the host so
        # we can reach LocalStack RDS at localhost:PORT from an ephemeral
        # postgres:17 container with --network host (Linux only).
        echo "INFO: target=local (Aurora in LocalStack) host=$PGHOST:$PGPORT db=$PGDATABASE user=$PGUSER (psql via ephemeral container)"
        run_psql_file() {
            docker run --rm -i \
                --network host \
                -e PGPASSWORD="$PGPASSWORD" \
                postgres:17 \
                psql --quiet --set ON_ERROR_STOP=on \
                     -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
                     < "$1"
        }
    else
        # Fallback: plain postgres:17 Docker container (aws_postgres_enabled=false).
        PGUSER="${POSTGRES_USER:-postgres}"
        PGDATABASE="${POSTGRES_NAME:-postgres}"
        PGPASSWORD="${POSTGRES_PASS:-postgres123}"
        CONTAINER_NAME="workshop-postgres"
        if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
            echo "ERROR: container ${CONTAINER_NAME} is not running."
            echo "       Start it with: docker compose up -d postgres"
            exit 1
        fi
        echo "INFO: target=local (plain Docker postgres) container=$CONTAINER_NAME db=$PGDATABASE user=$PGUSER"
        run_psql_file() {
            # `compose exec -T` disables TTY allocation so stdin redirection works.
            # We pass the file on stdin; the container reads from there. PGPASSWORD
            # is injected per-call so it never lands in `ps` listings on the host.
            cd "$PROJECT_ROOT"
            docker compose exec -T \
                -e PGPASSWORD="$PGPASSWORD" \
                postgres \
                psql --quiet --set ON_ERROR_STOP=on \
                     -U "$PGUSER" -d "$PGDATABASE" \
                     < "$1"
        }
    fi
fi
for file in "${files[@]}"; do
    echo "INFO: applying $(basename "$file")"
    run_psql_file "$file"
done
echo "INFO: migrations complete."
