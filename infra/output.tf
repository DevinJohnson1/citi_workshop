output "api_base_url" {
  description = "Base URL for API calls (for frontend REACT_APP_API_URL)"
  value       = data.aws_caller_identity.this.id == "000000000000" ? "" : try("https://${element(aws_cloudfront_distribution.this.*.domain_name, 0)}", "")
}

output "api_endpoints" {
  description = "Available API endpoints by function name"
  value = {
    for name, func in local.function_names :
    func.name => data.aws_caller_identity.this.id == "000000000000" ? module.lambda[name].lambda_function_url : "/api/${func.name}"
  }
}

output "cloudfront_distribution_id" {
  description = "The ID of the CloudFront distribution"
  value       = try(element(aws_cloudfront_distribution.this.*.id, 0), null)
}

output "cloudfront_distribution_url" {
  description = "The URL of the CloudFront distribution"
  value       = try(element(aws_cloudfront_distribution.this.*.domain_name, 0), null)
}

output "lambda_urls" {
  description = "The URLs of the Lambda functions"
  value       = { for name, lambda in module.lambda : lambda.lambda_function_name => lambda.lambda_function_url }
}

output "s3_bucket_id" {
  description = "The ID of the S3 bucket"
  value       = aws_s3_bucket.this.id
}

output "s3_bucket_name" {
  description = "The name of the S3 bucket"
  value       = aws_s3_bucket.this.bucket
}

output "website_url" {
  description = "The URL of the website"
  value       = data.aws_caller_identity.this.id == "000000000000" ? "http://${aws_s3_bucket.this.bucket}.s3-website.localhost.localstack.cloud:4566" : try("https://${element(aws_cloudfront_distribution.this.*.domain_name, 0)}", null)
}

output "cognito_user_pool_id" {
  description = "Cognito user pool ID (empty on LocalStack)."
  value       = try(element(aws_cognito_user_pool.this.*.id, 0), "")
}

output "cognito_client_id" {
  description = "Cognito app client ID consumed by the SPA (empty on LocalStack)."
  value       = try(element(aws_cognito_user_pool_client.this.*.id, 0), "")
}

output "cognito_issuer_url" {
  description = "OIDC issuer URL used by the frontend AuthProvider and PyJWT. On LocalStack returns the LocalStack endpoint (http://); on real AWS returns the Cognito endpoint (https://). The frontend's isAuthConfigured gate requires https:// so AuthProvider is NOT mounted locally, preventing spurious OIDC discovery requests to real AWS."
  value = local.cognito_enabled ? (
    data.aws_caller_identity.this.id == "000000000000"
    ? try(format("http://localhost.localstack.cloud:4566/%s", element(aws_cognito_user_pool.this.*.id, 0)), "")
    : try(format("https://cognito-idp.%s.amazonaws.com/%s", data.aws_region.this.region, element(aws_cognito_user_pool.this.*.id, 0)), "")
  ) : ""
}

output "cognito_domain" {
  description = "Hosted UI domain prefix (empty on LocalStack)."
  value       = try(element(aws_cognito_user_pool_domain.this.*.domain, 0), "")
}


# --- RDS outputs (consumed by bin/migrate.sh) ---
output "rds_endpoint" {
  description = "Aurora cluster writer endpoint (empty when aws_postgres_enabled=false). On LocalStack this is the cluster DNS; for Lambda containers use rds_host_lambda instead."
  value       = try(element(aws_rds_cluster.this.*.endpoint, 0), "")
}

output "rds_host_lambda" {
  description = "POSTGRES_HOST value injected into Lambda env vars. 'workshop-localstack' on LocalStack (Lambda containers reach LocalStack RDS via Docker network), actual endpoint on real AWS, empty when aws_postgres_enabled=false."
  value = var.aws_postgres_enabled ? (
    data.aws_caller_identity.this.id == "000000000000"
    ? "workshop-localstack"
    : try(element(aws_rds_cluster.this.*.endpoint, 0), "")
  ) : ""
}

output "rds_endpoint_external" {
  description = "Aurora host for external tools (bin/migrate.sh, pgAdmin). On LocalStack: 'localhost' (ports 4510-4559 are published to the host). On real AWS: the cluster writer endpoint. Empty when aws_postgres_enabled=false."
  value = var.aws_postgres_enabled ? (
    data.aws_caller_identity.this.id == "000000000000"
    ? "localhost"
    : try(element(aws_rds_cluster.this.*.endpoint, 0), "")
  ) : ""
}

output "rds_port" {
  description = "Aurora cluster port."
  value       = try(element(aws_rds_cluster.this.*.port, 0), 5432)
}

output "rds_database" {
  description = "Aurora database name."
  value       = try(element(aws_rds_cluster.this.*.database_name, 0), "")
}

output "rds_username" {
  description = "Aurora master username."
  value       = try(element(aws_rds_cluster.this.*.master_username, 0), "")
}

output "rds_password" {
  description = "Aurora master password. Workshop trade-off — see SYSTEM_DESIGN §11 R-03."
  sensitive   = true
  value       = try(element(aws_rds_cluster.this.*.master_password, 0), "")
}
