variable "aws_project" {
  description = "The AWS project name."
  type        = string
  default     = "coding-workshop"
}

variable "aws_bucket" {
  description = "The AWS S3 bucket name for terraform state storage."
  type        = string
  default     = "coding-workshop-us-east-1-abcd1234"
}

variable "aws_app_code" {
  description = "The AWS application unique code."
  type        = string
  default     = "abcd1234"
}

variable "aws_vpc_id" {
  description = "The AWS VPC identifier."
  type        = string
  default     = null
}

variable "aws_postgres_enabled" {
  description = "Enable Aurora PostgreSQL. When true (default), Aurora is provisioned in both LocalStack Pro and real AWS. LocalStack Pro (LOCALSTACK_AUTH_TOKEN) is required for local Aurora emulation. Set to false only for LocalStack Community (no RDS support) — the plain postgres:17 Docker container in docker-compose.yml is used as a fallback in that case."
  type        = bool
  default     = true
}

variable "aws_postgres_host" {
  description = "Override the Lambda POSTGRES_HOST env var. Only relevant when aws_postgres_enabled=false (plain Docker postgres fallback). Defaults to 'postgres' (Docker service name). On some Linux configurations with Docker Desktop you may need '172.17.0.1'."
  type        = string
  default     = null
}

variable "cloudfront_domain" {
  description = "Optional CloudFront domain (e.g. d123abc.cloudfront.net) to register as a Cognito callback/logout URL. Leave empty on the first apply, then rerun with `-var cloudfront_domain=$(terraform output -raw cloudfront_distribution_url)` to add it. Kept as a var to avoid a Lambda/Cognito/CloudFront graph cycle."
  type        = string
  default     = ""
}

variable "enable_cognito" {
  description = "Provision the Cognito user pool, app client, and hosted UI domain. Default false because the workshop participant IAM role typically lacks cognito-idp:CreateUserPool. Override with `TF_VAR_enable_cognito=true` (or `-var enable_cognito=true`) when running against LocalStack Pro or an AWS account whose role does grant cognito-idp:*. When false the Lambdas will reject authenticated requests because no user pool exists."
  type        = bool
  default     = false
}

variable "enable_dev_auth_bypass" {
  description = "DEV-ONLY ESCAPE HATCH. When true, the SPA short-circuits sign-in for the four legacy seed personas (admin/lead/member/viewer @workshop.local) and the Lambdas accept the resulting `dev-bypass.<email>.<b64-password>.<nonce>` bearer tokens without any cryptographic verification — only a plaintext compare against `workshop_password`. Defaults to TRUE because the workshop template ships shared seed accounts and a public SPA; the bypass keeps the dev loop unblocked when Cognito provisioning is flaky. Set to false (e.g. `-var enable_dev_auth_bypass=false`) for any deployment that holds non-disposable data."
  type        = bool
  default     = true
}

variable "workshop_password" {
  description = "Shared plaintext password the four @workshop.local seed personas must present when the dev-auth bypass is enabled. Compared verbatim inside the Lambda (no hashing) against the password embedded in the bearer token. Wire from the host shell with `export TF_VAR_workshop_password=$WORKSHOP_PASSWORD` (deploy-backend.sh does this automatically if `.env` exists in the project root). Anyone with the SPA bundle can read this value — treat it as friction, not as security."
  type        = string
  default     = "Workshop!2026"
  sensitive   = true
}
