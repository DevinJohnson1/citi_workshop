#!/usr/bin/env bash
# Script: Database Migration Runner
# Purpose: Apply every backend/_db/migrations/*.sql against Postgres by
#          invoking the in-VPC migrate-service Lambda.
# Usage:   ./bin/migrate.sh [aws|local]
# Default: local
#
# One path, both targets:
#   - local: invokes the Lambda on LocalStack (http://localhost:4566). The
#            Lambda runs inside the LocalStack container, on the same
#            Docker network as workshop-postgres / LocalStack Aurora, so
#            it can reach Postgres no matter which of those is in use.
#   - aws:   invokes the Lambda in real AWS. The Lambda lives inside the
#            VPC alongside Aurora, so participants don't need a route
#            into the VPC (no VPN / SSM tunnel) to run migrations.
#
# The Lambda ships every backend/_db/migrations/*.sql baked into its
# deployment package (see bin/deploy-backend.sh — the rsync step that
# populates backend/migrate-service/_migrations/). The handler runs each
# file in its own transaction in lex order; the SQL is idempotent
# (CREATE … IF NOT EXISTS, ON CONFLICT DO NOTHING, …) so re-running is
# safe.
#
# Requirements: aws CLI, terraform, jq. No psql/docker needed on the host.
set -euo pipefail
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    cat <<'USAGE'
Usage: bin/migrate.sh [aws|local]
Apply every backend/_db/migrations/*.sql against the target Postgres by
invoking the migrate-service Lambda. The Lambda is auto-deployed by
bin/deploy-backend.sh; this script just calls it.
  local   LocalStack (default). Lambda runs inside LocalStack and connects
          to whichever Postgres the stack is using (LocalStack Aurora when
          aws_postgres_enabled=true, the workshop-postgres compose service
          otherwise).
  aws     Real AWS. Lambda runs inside the VPC and connects to Aurora.
Re-running is safe — migrations are idempotent.
USAGE
    exit 0
fi
echo "================================="
echo "ACME Project Tracker - Migrations"
echo "================================="
command -v aws       >/dev/null 2>&1 || { echo "ERROR: aws CLI is missing";   exit 1; }
command -v terraform >/dev/null 2>&1 || { echo "ERROR: terraform is missing"; exit 1; }
command -v jq        >/dev/null 2>&1 || { echo "ERROR: jq is missing";        exit 1; }
# Silence the AWS CLI v2 output pager so JSON streams straight to stdout.
export AWS_PAGER=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
TARGET="${1:-local}"
# Per-target environment for the AWS CLI + terraform. LocalStack needs the
# endpoint env vars and dummy creds; real AWS uses whatever the participant
# already has in ENVIRONMENT.config / the ambient shell.
if [ "$TARGET" = "local" ]; then
    export AWS_ENDPOINT_URL="http://localhost:4566"
    # Required for Terraform ≥1.13 S3 backend reads (separate from AWS_ENDPOINT_URL).
    export AWS_ENDPOINT_URL_S3="http://s3.localhost.localstack.cloud:4566"
    export AWS_ACCESS_KEY_ID="test"
    export AWS_SECRET_ACCESS_KEY="test"
    export AWS_REGION="${AWS_REGION:-us-east-1}"
    unset AWS_SESSION_TOKEN
    PARTICIPANT_ID="${PARTICIPANT_ID:-abcd1234}"
    BUCKET_NAME="coding-workshop-tfstate-${PARTICIPANT_ID}"
elif [ "$TARGET" = "aws" ]; then
    if [ -f "$PROJECT_ROOT/ENVIRONMENT.config" ]; then
        # shellcheck disable=SC1091
        source "$PROJECT_ROOT/ENVIRONMENT.config"
    fi
    if [ -z "${PARTICIPANT_ID:-}" ]; then
        echo "ERROR: PARTICIPANT_ID is not set. Run bin/setup-participant.sh first."
        exit 1
    fi
    BUCKET_NAME="coding-workshop-tfstate-${PARTICIPANT_ID}"
else
    echo "ERROR: unknown target '$TARGET' (use 'local' or 'aws')"
    exit 1
fi
# Resolve the Lambda function name. The shared lambda module names every
# function "<aws_project>-<service>-<app_id>"; we read lambda_urls from
# terraform outputs and pull out the migrate-service hostname, which IS
# the function name on AWS. Fallback to constructing it from project +
# participant id if the output is shaped differently (older module versions).
pushd "$PROJECT_ROOT/infra" >/dev/null
terraform init -reconfigure \
    -backend-config="bucket=$BUCKET_NAME" \
    -backend-config="region=${AWS_REGION:-us-east-1}" \
    >/dev/null 2>&1 || true
FN_NAME="$(terraform output -json 2>/dev/null \
    | jq -r '.lambda_urls.value // {} | to_entries[] | select(.key == "migrate-service") | .value' \
    | sed -E 's#https://([^.]+)\..*#\1#')"
if [ -z "$FN_NAME" ]; then
    AWS_PROJECT="$(terraform output -raw aws_project 2>/dev/null || echo coding-workshop)"
    FN_NAME="${AWS_PROJECT}-migrate-service-${PARTICIPANT_ID}"
fi
popd >/dev/null
echo "INFO: target=$TARGET invoking Lambda: $FN_NAME"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
# raw-in-base64-out lets us pass a literal JSON payload on AWS CLI v2 without
# base64-encoding it first. The handler ignores the payload — IAM (or
# LocalStack's permissive auth) has already authorised the call.
HTTP_STATUS=$(aws lambda invoke \
    --function-name "$FN_NAME" \
    --payload '{}' \
    --cli-binary-format raw-in-base64-out \
    --query 'StatusCode' --output text \
    "$OUT")
echo ""
echo "INFO: Lambda response (HTTP $HTTP_STATUS):"
if jq -e . <"$OUT" >/dev/null 2>&1; then
    jq . <"$OUT"
else
    cat "$OUT"; echo
fi
# Handler reports logical failure inside the JSON body even when the HTTP
# call itself succeeded — surface that as a non-zero exit.
if jq -e '.ok == false' <"$OUT" >/dev/null 2>&1; then
    echo ""
    echo "ERROR: migration run reported failure — see .error and .applied above."
    echo "       CloudWatch logs:"
    echo "         aws logs tail /aws/lambda/$FN_NAME --follow --since 10m"
    exit 1
fi
if [ "$HTTP_STATUS" != "200" ]; then
    echo "ERROR: aws lambda invoke returned HTTP $HTTP_STATUS"
    exit 1
fi
echo ""
echo "INFO: migrations complete."
