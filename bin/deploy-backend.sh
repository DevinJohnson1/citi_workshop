#!/usr/bin/env bash
# Script: Backend Infrastructure Deployment
# Purpose: Deploy backend infrastructure for the coding workshop
# Usage: ./deploy-backend.sh [aws|local]
# Default: aws

set -e

# Usage helper
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: $0 [aws|local]"
    echo "Deploy backend infrastructure for the coding workshop"
    echo ""
    echo "Arguments:"
    echo "  aws             Deploy to AWS (default)"
    echo "  local           Deploy to LocalStack for development"
    echo ""
    echo "Options:"
    echo "  -h, --help      Show this help message"
    echo ""
    echo "Requirements:"
    echo "  - terraform installed"
    echo "  - ENVIRONMENT.config file (auto-created for AWS)"
    echo ""
    echo "Examples:"
    echo "  $0              # Deploy to AWS"
    echo "  $0 aws          # Deploy to AWS"
    echo "  $0 local        # Deploy to LocalStack"
    exit 0
fi

echo "===================================="
echo "Coding Workshop - Backend Deployment"
echo "===================================="
echo ""

# Set up PATH and AWS region
export PATH="$HOME/.local/bin:$PATH"
export AWS_REGION=${AWS_REGION:-us-east-1}

# Verify required dependencies
terraform --version > /dev/null 2>&1 || { echo "ERROR: 'terraform' is missing. Aborting..."; exit 1; }

# Resolve script directory and project root paths
SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
PROJECT_ROOT="$(cd $SCRIPT_DIR/.. > /dev/null 2>&1 || exit 1; pwd -P)"

# Define configuration file paths
ENVIRONMENT_CONFIG="$PROJECT_ROOT/ENVIRONMENT.config"
INFRA_DIR="$PROJECT_ROOT/infra"
ENVIRONMENT=${1:-"aws"}

echo "INFO: Deploying infrastructure..."
echo "INFO: Environment - $ENVIRONMENT"

# Change to infrastructure directory
cd "$INFRA_DIR"

# AWS Deployment Configuration
if [ "$ENVIRONMENT" = "aws" ]; then
    echo "INFO: Using AWS deployment (terraform)..."

    # Setup participant if config is missing
    $SCRIPT_DIR/setup-participant.sh

    # Load participant-specific configuration if available
    if [ -f "$ENVIRONMENT_CONFIG" ]; then
        echo "INFO: Loading participant environment configuration..."
        source $ENVIRONMENT_CONFIG
    else
        echo "WARNING: $ENVIRONMENT_CONFIG is missing"
    fi
else
    # Local development configuration — override credentials for LocalStack
    export AWS_ENDPOINT_URL="http://localhost:4566"
    export AWS_ENDPOINT_URL_S3="http://s3.localhost.localstack.cloud:4566"
    export AWS_ACCESS_KEY_ID=test
    export AWS_SECRET_ACCESS_KEY=test
    export AWS_REGION=us-east-1
    unset AWS_SESSION_TOKEN

    # Ensure PARTICIPANT_ID is exported so the shared `terraform init` branch
    # below passes a matching `-backend-config bucket=...` override instead of
    # falling back to the placeholder in infra/provider.tf.
    export PARTICIPANT_ID="${PARTICIPANT_ID:-abcd1234}"

    # Auto-enable Cognito resources when the operator is running LocalStack Pro
    # (community edition returns 501 Not Implemented for cognito-idp). Detection
    # is best-effort: if LOCALSTACK_IMAGE contains "pro", flip the TF var.
    # Sourced from .env via docker compose; we re-read it here for parity.
    if [ -f "$PROJECT_ROOT/.env" ]; then
        # shellcheck disable=SC1090
        set -a; . "$PROJECT_ROOT/.env"; set +a
    fi
    if [[ "${LOCALSTACK_IMAGE:-}" == *pro* ]]; then
        export TF_VAR_enable_cognito=true
        echo "INFO: LocalStack Pro detected — enabling Cognito (TF_VAR_enable_cognito=true)"
    fi

    BUCKET_NAME="coding-workshop-tfstate-${PARTICIPANT_ID}"
    if ! aws s3 ls | grep -q "$BUCKET_NAME"; then
        aws s3 mb "s3://$BUCKET_NAME"
    fi
fi

# Initialize Terraform with backend configuration
if [ -n "$PARTICIPANT_ID" ]; then
    echo "INFO: Using custom backend configuration..."
    terraform init -reconfigure -backend-config="bucket=coding-workshop-tfstate-${PARTICIPANT_ID:-abcd1234}" -backend-config="region=${AWS_REGION:-us-east-1}"
else
    echo "WARNING: No backend.config found. Using default backend configuration."
    echo "INFO: For multi-participant workshops, run: ./bin/setup-participant.sh"
    terraform init -reconfigure
fi

# Apply Terraform configuration automatically
# Bundle backend/_lib/ into every backend/<svc>/_lib/ so each Lambda zip ships
# with its own copy (no symlinks — they break on Windows). The copied folders
# are gitignored. See SYSTEM_DESIGN §10 "Lambda packaging".
LIB_SRC="$PROJECT_ROOT/backend/_lib"
if [ -d "$LIB_SRC" ]; then
    for svc in "$PROJECT_ROOT"/backend/*/function.py; do
        d="$(dirname "$svc")"
        case "$(basename "$d")" in _*) continue ;; esac
        rsync -a --delete "$LIB_SRC/" "$d/_lib/"
    done
fi

terraform apply -auto-approve
echo "INFO: Infrastructure deployment complete!"

# Display API endpoint
if [ -n "$API_BASE_URL" ]; then
    echo ""
    echo "API Base URL: $API_BASE_URL"
fi
if [ -n "$API_ENDPOINTS" ]; then
    echo ""
    echo "API Endpoints: $API_ENDPOINTS"
fi
