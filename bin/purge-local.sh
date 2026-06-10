#!/usr/bin/env bash
# Script:  Local Full Purge
# Purpose: Wipe every piece of local state created by bin/start-dev.sh —
#          LocalStack + Postgres containers, their named volumes, any orphan
#          Lambda child containers LocalStack spawned, the coding-workshop
#          docker network, Terraform state + provider cache + build zips,
#          per-service _lib copies, and frontend/.env.local.
# Usage:   ./bin/purge-local.sh [-y|--yes]
#
# After this script completes, ./bin/start-dev.sh will rebuild from zero
# (~60-90 s on the first invocation since Terraform has to re-apply 8 Lambdas).
#
# NOT for AWS. To tear down a deployed workshop env, use bin/cleanup-environment.sh.

set -euo pipefail

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    cat <<'USAGE'
Usage: bin/purge-local.sh [-y|--yes]

Wipe ALL local workshop state. Destructive and irreversible — there is no
backup step. Use bin/cleanup-environment.sh for the AWS workflow instead.

Options:
  -y, --yes   Skip the confirmation prompt (for CI / scripted use).
  -h, --help  Show this message.

Removes:
  • containers: workshop-localstack, workshop-postgres, every
    workshop-localstack-lambda-* child container
  • volumes:    coding-workshop_localstack_data, coding-workshop_postgres_data
  • network:    coding-workshop
  • files:      infra/.terraform/, infra/.terraform.lock.hcl,
                infra/terraform.tfstate*, infra/builds/,
                backend/<svc>/_lib/, frontend/.env.local
USAGE
    exit 0
fi

ASSUME_YES=false
[ "${1:-}" = "-y" ] || [ "${1:-}" = "--yes" ] && ASSUME_YES=true

SCRIPT_DIR="$(cd "$(dirname "$0")" >/dev/null 2>&1; pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1; pwd -P)"
cd "$PROJECT_ROOT"

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is missing"; exit 1; }
docker info >/dev/null 2>&1       || { echo "ERROR: docker daemon is not running"; exit 1; }

echo "==================================================="
echo "Local Full Purge — destructive, no backup"
echo "==================================================="
if [ "$ASSUME_YES" != true ]; then
    read -r -p "Type 'purge' to confirm: " ans
    [ "$ans" = "purge" ] || { echo "aborted"; exit 1; }
fi

echo ""
echo "[1/7] docker compose down --volumes --remove-orphans"
# `--profile postgres` so compose sees the postgres service definition even
# when the profile wasn't active; otherwise its volume isn't removed.
docker compose --profile postgres down --volumes --remove-orphans 2>/dev/null || true

echo ""
echo "[2/7] Reaping orphan Lambda containers"
# By network first (covers the case where LocalStack named them something
# unexpected), then by name prefix (covers the case where the network was
# already torn down before the orphan was reaped).
ORPHANS=$(docker ps -aq --filter "network=coding-workshop" 2>/dev/null || true)
[ -n "$ORPHANS" ] && echo "$ORPHANS" | xargs -r docker rm -f >/dev/null
ORPHANS=$(docker ps -aq --filter "name=workshop-localstack-lambda-" 2>/dev/null || true)
[ -n "$ORPHANS" ] && echo "$ORPHANS" | xargs -r docker rm -f >/dev/null
echo "  done"

echo ""
echo "[3/7] Removing coding-workshop network (if any)"
docker network rm coding-workshop 2>/dev/null && echo "  removed" || echo "  (already gone)"

echo ""
echo "[4/7] Removing named volumes (belt-and-braces)"
docker volume rm coding-workshop_localstack_data coding-workshop_postgres_data 2>/dev/null || true
echo "  done"

echo ""
echo "[5/7] Wiping Terraform state, lock, and Lambda build zips"
rm -rf infra/.terraform infra/.terraform.lock.hcl \
       infra/terraform.tfstate infra/terraform.tfstate.backup \
       infra/builds
echo "  done"

echo ""
echo "[6/7] Dropping per-service _lib copies"
# start-dev.sh / deploy-backend.sh rsync these back from backend/_lib/.
# The vendored pip deps (psycopg/, pydantic/, *.dist-info/, ...) are LEFT IN
# PLACE — start-dev.sh detects manifest drift and prunes/reinstalls only
# when requirements.txt actually changed.
find backend -mindepth 2 -maxdepth 2 -type d -name _lib -exec rm -rf {} +
echo "  done"

echo ""
echo "[7/7] Removing generated frontend env"
rm -f frontend/.env.local
echo "  done"

echo ""
echo "==================================================="
echo "Purge complete. Rebuild with: ./bin/start-dev.sh"
echo "==================================================="


