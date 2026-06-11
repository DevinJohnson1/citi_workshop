#!/usr/bin/env bash
# Script: Frontend Application Deployment
# Purpose: Deploy frontend infrastructure for the coding workshop
# Usage: ./deploy-frontend.sh [aws|local]
# Default: aws

set -e

# Usage helper
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: $0 [aws|local]"
    echo "Deploy frontend application for the coding workshop"
    echo ""
    echo "Arguments:"
    echo "  aws             Build and deploy to AWS S3/CloudFront (default)"
    echo "  local           Skip build (use start-dev.sh for local development)"
    echo ""
    echo "Options:"
    echo "  -h, --help      Show this help message"
    echo ""
    echo "Requirements:"
    echo "  - aws cli installed"
    echo "  - npm installed"
    echo "  - terraform installed"
    echo "  - Backend infrastructure deployed first"
    echo ""
    echo "Examples:"
    echo "  $0              # Deploy to AWS"
    echo "  $0 aws          # Deploy to AWS"
    echo "  $0 local        # Local development mode"
    exit 0
fi

echo "====================================="
echo "Coding Workshop - Frontend Deployment"
echo "====================================="
echo ""

# Verify required dependencies
aws --version > /dev/null 2>&1 || { echo "ERROR: 'aws' is missing. Aborting..."; exit 1; }
npm --version > /dev/null 2>&1 || { echo "ERROR: 'npm' is missing. Aborting..."; exit 1; }
terraform --version > /dev/null 2>&1 || { echo "ERROR: 'terraform' is missing. Aborting..."; exit 1; }

# Resolve script directory and project root paths
SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
PROJECT_ROOT="$(cd $SCRIPT_DIR/.. > /dev/null 2>&1 || exit 1; pwd -P)"

# Define project directories
ENVIRONMENT_CONFIG="$PROJECT_ROOT/ENVIRONMENT.config"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
INFRA_DIR="$PROJECT_ROOT/infra"
ENVIRONMENT=${1:-"aws"}

# Set up PATH and AWS region
export PATH="$HOME/.local/bin:$PATH"
export AWS_REGION=${AWS_REGION:-us-east-1}

# Disable AWS CLI v2 output pager. Without this, commands that emit JSON
# (e.g. `aws cloudfront create-invalidation`) pipe into `less` and appear to
# hang the deploy until the user presses `q`.
export AWS_PAGER=""

echo "INFO: Deploying frontend..."
echo "INFO: Environment - $ENVIRONMENT"

# AWS Deployment Configuration
if [ "$ENVIRONMENT" = "aws" ]; then
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
    # Local development configuration
    export AWS_ENDPOINT_URL="http://localhost:4566"
    export AWS_ENDPOINT_URL_S3="http://s3.localhost.localstack.cloud:4566"

    BUCKET_NAME="coding-workshop-tfstate-${PARTICIPANT_ID:-abcd1234}"
    if ! aws s3 ls | grep -q "$BUCKET_NAME"; then
        aws s3 mb "s3://$BUCKET_NAME"
    fi
fi

# Change to infrastructure directory
cd "$INFRA_DIR"

# Retrieve S3 bucket name from Terraform outputs
BUCKET_NAME=$(terraform output -raw s3_bucket_name 2>/dev/null || echo "")
echo "INFO: Target bucket - $BUCKET_NAME"

# Verify S3 bucket exists (indicates backend infrastructure is deployed)
if [ -z "$BUCKET_NAME" ]; then
    echo "ERROR: Could not get S3 bucket name from Terraform outputs"
    echo "INFO: Make sure backend is deployed first: ./bin/deploy-backend.sh $ENVIRONMENT"
    exit 1
fi

# Retrieve API configuration from Terraform outputs
API_BASE_URL=$(terraform output -raw api_base_url 2>/dev/null || echo "")
echo "INFO: API Base URL - $API_BASE_URL"
API_ENDPOINTS=$(terraform output -json api_endpoints 2>/dev/null || echo "{}")
echo "INFO: API Endpoints - $API_ENDPOINTS"

# Local Development: Skip frontend build (use start-dev.sh instead)
# AWS Deployment: Build and upload to S3
if [ "$ENVIRONMENT" = "local" ]; then
    echo ""
    echo "======================================================="
    echo "Local: Frontend should be run with './bin/start-dev.sh'"
    echo "======================================================="
    echo "To run frontend locally:"
    echo "  1. Start dev environment: ./bin/start-dev.sh"
    echo "  2. Open browser: http://localhost:3000"
    echo ""
    exit 0
fi

# Regenerate frontend/.env.local from the CURRENT terraform outputs before
# building. Without this step, `npm run build` inlines whatever
# VITE_COGNITO_CLIENT_ID / authority / endpoint happens to be on disk — which
# is stale whenever the Cognito user pool client was re-created by a recent
# `terraform apply`. Symptom in prod: cognito-idp returns
#   "Unable to find user pool client with ID <old-id>"
# even though the live pool has a different id. Regenerating here makes the
# build deterministic w.r.t. the deployed infra.
echo "INFO: Refreshing frontend/.env.local from terraform outputs..."
"$SCRIPT_DIR/generate-env.sh"

# Build React frontend for production
cd "$FRONTEND_DIR"
echo "INFO: Building frontend..."

# Install dependencies on first run (or when package-lock.json is newer than
# node_modules). Without this, fresh machines fail with TS2307/TS2688 errors
# because vite, @vitejs/plugin-react, @tailwindcss/vite, and the vite/client
# type definitions have not been installed yet.
if [ ! -d "node_modules" ] || [ package-lock.json -nt node_modules ]; then
    echo "INFO: Installing frontend dependencies..."
    if [ -f package-lock.json ]; then
        npm ci
    else
        npm install
    fi
fi

# Set API environment variables for build (REACT_APP_* for CRA, VITE_* for Vite)
export REACT_APP_API_URL="$API_BASE_URL"
export REACT_APP_API_ENDPOINTS="$API_ENDPOINTS"
export VITE_API_URL="$API_BASE_URL"
export VITE_API_ENDPOINTS="$API_ENDPOINTS"

# Run production build
npm run build

# Prepare S3 upload
echo "INFO: Uploading to S3..."

# Detect build output directory (Vite uses dist/, CRA uses build/)
if [ -d "dist" ]; then
    BUILD_DIR="dist"
elif [ -d "build" ]; then
    BUILD_DIR="build"
else
    echo "ERROR: No build output found (expected dist/ or build/)"
    exit 1
fi
echo "INFO: Build directory - $BUILD_DIR"

# Strip env files from the build output. Vite already inlined every VITE_*
# value into the JS bundle at build time, so these files have zero runtime
# effect — uploading them to the public S3 bucket would only leak config
# (authority URL, client id, endpoint hostnames) to anyone who guesses /.env.
rm -f "$BUILD_DIR/.env" "$BUILD_DIR/.env.local" "$BUILD_DIR/.env.sample"

# Upload built frontend to S3 (with deletion of old files)
aws s3 sync $BUILD_DIR/ s3://$BUCKET_NAME/ --delete $AWS_ENDPOINT

# Invalidate CloudFront cache for AWS deployments
if [ "$ENVIRONMENT" = "aws" ]; then
    cd "$INFRA_DIR"
    
    # Retrieve CloudFront distribution ID from Terraform outputs
    DISTRIBUTION_ID=$(terraform output -raw cloudfront_distribution_id 2>/dev/null || echo "")
    
    # Create cache invalidation for all files
    if [ -n "$DISTRIBUTION_ID" ]; then
        echo "INFO: Invalidating CloudFront cache..."
        aws cloudfront create-invalidation \
            --distribution-id "$DISTRIBUTION_ID" \
            --paths "/*"
    fi
fi

echo "INFO: Frontend deployment complete!"

# Display CloudFront URL
cd "$INFRA_DIR"
URL=$(terraform output -raw website_url 2>/dev/null || echo "")

if [ -n "$URL" ]; then
    echo ""
    echo "CloudFront URL: $URL"
fi
