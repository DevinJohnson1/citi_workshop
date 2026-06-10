#!/usr/bin/env bash
# Script:  Cognito Seed Users
# Purpose: Create four canonical workshop personas in the deployed Cognito
#          user pool — one per role (admin, team_lead, team_member, viewer).
#          Idempotent: re-running is a no-op for users that already exist.
# Usage:   ./bin/seed-cognito.sh [local|aws]   (default: local)
#
# The matching role assignment on the backend side lives in
# backend/_lib/auth.py (_SEED_ROLES). Keep the email list in sync there.

set -euo pipefail

TARGET="${1:-local}"
PASSWORD="${WORKSHOP_PASSWORD:-Workshop!2026}"

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    cat <<USAGE
Usage: bin/seed-cognito.sh [local|aws]

Creates four default Cognito users with the shared password
"\$WORKSHOP_PASSWORD" (default: $PASSWORD).

  admin@workshop.local     role=admin
  lead@workshop.local      role=team_lead
  member@workshop.local    role=team_member
  viewer@workshop.local    role=viewer

Re-running the script is safe; existing users are left alone.
USAGE
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" >/dev/null 2>&1; pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1; pwd -P)"
INFRA_DIR="$PROJECT_ROOT/infra"

command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI is missing"; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo "ERROR: terraform is missing"; exit 1; }

# Point the AWS CLI at LocalStack for the "local" target so we don't accidentally
# create users in a real AWS account when the developer has stale creds.
if [ "$TARGET" = "local" ]; then
    export AWS_ENDPOINT_URL="http://localhost:4566"
    # AWS_ENDPOINT_URL_S3 is required for Terraform ≥1.13 S3 backend reads.
    export AWS_ENDPOINT_URL_S3="http://s3.localhost.localstack.cloud:4566"
    export AWS_ACCESS_KEY_ID="test"
    export AWS_SECRET_ACCESS_KEY="test"
    export AWS_REGION="${AWS_REGION:-us-east-1}"
    unset AWS_SESSION_TOKEN
fi

cd "$INFRA_DIR"
POOL_ID="$(terraform output -raw cognito_user_pool_id 2>/dev/null || true)"
if [ -z "$POOL_ID" ]; then
    echo "WARNING: cognito_user_pool_id is empty — Cognito is not deployed."
    echo "         Either run ./bin/deploy-backend.sh first, or (on LocalStack"
    echo "         Community) set TF_VAR_enable_cognito=false and skip this step."
    exit 0
fi

echo "==================================="
echo "Coding Workshop - Cognito Seed"
echo "==================================="
echo "INFO: target=$TARGET pool=$POOL_ID"

# email|role pairs. Roles are advisory metadata; the source of truth is
# backend/_lib/auth.py (_SEED_ROLES) — kept in sync by convention.
SEED_USERS=(
    "admin@workshop.local|admin"
    "lead@workshop.local|team_lead"
    "member@workshop.local|team_member"
    "viewer@workshop.local|viewer"
)

for entry in "${SEED_USERS[@]}"; do
    email="${entry%%|*}"
    role="${entry##*|}"

    if aws cognito-idp admin-get-user \
            --user-pool-id "$POOL_ID" --username "$email" \
            >/dev/null 2>&1; then
        echo "  ✓ $email already exists (role=$role)"
        continue
    fi

    aws cognito-idp admin-create-user \
        --user-pool-id "$POOL_ID" \
        --username "$email" \
        --user-attributes "Name=email,Value=$email" "Name=email_verified,Value=true" \
        --message-action SUPPRESS \
        >/dev/null
    aws cognito-idp admin-set-user-password \
        --user-pool-id "$POOL_ID" \
        --username "$email" \
        --password "$PASSWORD" \
        --permanent \
        >/dev/null
    echo "  + $email created (role=$role)"
done

echo ""
echo "Sign in at http://localhost:3000/login with any of:"
for entry in "${SEED_USERS[@]}"; do
    printf "    %-25s  password: %s\n" "${entry%%|*}" "$PASSWORD"
done
echo ""

