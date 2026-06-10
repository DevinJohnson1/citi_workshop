#!/usr/bin/env bash
# Script: Generate Frontend Environment Configuration
# Purpose: Generate .env.local file for React frontend with API configuration
# Usage: ./generate-env.sh

set -e

# Usage helper
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: $0"
    echo "Generate .env.local file for React frontend with API configuration"
    echo ""
    echo "Description:"
    echo "  Retrieves API configuration from Terraform outputs and"
    echo "  generates .env.local file for React development"
    echo ""
    echo "Options:"
    echo "  -h, --help      Show this help message"
    echo ""
    echo "Requirements:"
    echo "  - terraform installed"
    echo "  - Backend infrastructure deployed"
    echo ""
    echo "Output:"
    echo "  Creates frontend/.env.local with API configuration"
    exit 0
fi

echo "======================================"
echo "Coding Workshop - Generate Environment"
echo "======================================"
echo ""

# Resolve script directory and project root paths
SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
PROJECT_ROOT="$(cd $SCRIPT_DIR/.. > /dev/null 2>&1 || exit 1; pwd -P)"

# Define project directories and output file
FRONTEND_DIR="$PROJECT_ROOT/frontend"
INFRA_DIR="$PROJECT_ROOT/infra"
ENVIRONMENT_CONFIG="$FRONTEND_DIR/.env.local"

# Change to infrastructure directory to retrieve Terraform outputs
cd "$INFRA_DIR"

# Load participant configuration
PARTICIPANT_CONFIG="$PROJECT_ROOT/ENVIRONMENT.config"
if [ -f "$PARTICIPANT_CONFIG" ]; then
    source "$PARTICIPANT_CONFIG"
fi

# Detect environment (local with LocalStack or AWS)
if curl -s http://localhost:4566/_localstack/health > /dev/null 2>&1; then
    # LocalStack is running — use it
    ENVIRONMENT="local"
    export AWS_ENDPOINT_URL="http://localhost:4566"
    export AWS_ENDPOINT_URL_S3="http://s3.localhost.localstack.cloud:4566"
    export AWS_ACCESS_KEY_ID=test
    export AWS_SECRET_ACCESS_KEY=test
    export AWS_REGION=us-east-1
    unset AWS_SESSION_TOKEN
    BUCKET_NAME="coding-workshop-tfstate-${PARTICIPANT_ID:-abcd1234}"
else
    # AWS deployment environment
    ENVIRONMENT="aws"
    BUCKET_NAME="coding-workshop-tfstate-${PARTICIPANT_ID:-abcd1234}"
fi

# Initialize terraform with the correct backend so outputs come from the right state
terraform init -reconfigure \
    -backend-config="bucket=$BUCKET_NAME" \
    -backend-config="region=${AWS_REGION:-us-east-1}" \
    > /dev/null 2>&1

# Retrieve API base URL from Terraform outputs
ALL_OUTPUTS=$(terraform output -json 2>/dev/null || echo "{}")
API_BASE_URL=$(echo "$ALL_OUTPUTS" | grep -o '"api_base_url":{[^}]*}' | grep -o '"value":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -z "$ALL_OUTPUTS" ] || [ "$ALL_OUTPUTS" = "{}" ]; then
    echo "WARNING: Could not get outputs from Terraform"
    echo "Make sure infrastructure is deployed first with: ./bin/deploy-backend.sh"
    exit 1
fi

# Fallback using terraform output -raw (suppress stderr warnings)
if [ -z "$API_BASE_URL" ]; then
    API_BASE_URL=$(terraform output -raw api_base_url 2>/dev/null || echo "")
fi

# Handle empty API base URL (valid for local development - uses direct Lambda URLs)
if [ -z "$API_BASE_URL" ]; then
    echo "API Base URL: (empty - using direct Lambda Function URLs)"
    API_BASE_URL="http://localhost:3001"
else
    echo "API Base URL: $API_BASE_URL"
fi

# Retrieve API endpoints and Lambda URLs from Terraform outputs
API_ENDPOINTS=$(terraform output -json api_endpoints 2>/dev/null || echo "{}")
LAMBDA_URLS=$(terraform output -json lambda_urls 2>/dev/null || echo "{}")

# Cognito outputs. With var.enable_cognito=true these are populated on
# LocalStack Pro too. The frontend uses VITE_COGNITO_ENDPOINT to call
# cognito-idp's InitiateAuth directly (USER_PASSWORD_AUTH) from the login form;
# the AWS region in VITE_COGNITO_REGION is used to sign that request.
COGNITO_CLIENT_ID=$(terraform output -raw cognito_client_id 2>/dev/null || echo "")
COGNITO_ISSUER_URL=$(terraform output -raw cognito_issuer_url 2>/dev/null || echo "")
COGNITO_DOMAIN=$(terraform output -raw cognito_domain 2>/dev/null || echo "")

if [ "$ENVIRONMENT" = "aws" ]; then
    VITE_COGNITO_ENDPOINT="https://cognito-idp.${AWS_REGION:-us-east-1}.amazonaws.com"
else
    # Browser → CORS proxy (/cognito) → cognito-idp regional subdomain. The
    # browser cannot call cognito-idp directly on LocalStack because the
    # OPTIONS preflight returns 403 with no CORS headers.
    VITE_COGNITO_ENDPOINT="http://localhost:3001/cognito"
fi
VITE_COGNITO_REGION="${AWS_REGION:-us-east-1}"

# Frontend base URL: '/api' when CloudFront fronts it, proxy on localhost otherwise.
if [ "$ENVIRONMENT" = "aws" ]; then
    VITE_API_BASE_URL="/api"
    VITE_REDIRECT_URI="${API_BASE_URL%/}/login/callback"
else
    VITE_API_BASE_URL="http://localhost:3001/api"
    VITE_REDIRECT_URI="http://localhost:3000/login/callback"
fi

# Generate .env.local configuration file for React frontend
cat > "$ENVIRONMENT_CONFIG" << EOF
# Auto-generated environment file
# Generated on: $(date)
# Environment: $ENVIRONMENT
VITE_API_BASE_URL=$VITE_API_BASE_URL
VITE_API_ENDPOINTS='$API_ENDPOINTS'
VITE_LAMBDA_URLS='$LAMBDA_URLS'
VITE_COGNITO_AUTHORITY=$COGNITO_ISSUER_URL
VITE_COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID
VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN
VITE_COGNITO_REDIRECT_URI=$VITE_REDIRECT_URI
VITE_COGNITO_ENDPOINT=$VITE_COGNITO_ENDPOINT
VITE_COGNITO_REGION=$VITE_COGNITO_REGION
EOF

echo ""
echo "Contents:"
cat "$ENVIRONMENT_CONFIG"
echo ""
echo "✓ Created $ENVIRONMENT_CONFIG"
echo ""
