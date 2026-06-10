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
  description = "Force-enable Cognito resources even on LocalStack (account id 000000000000). Default true — assumes LocalStack Pro locally. Set false only when running LocalStack Community, in which case Cognito resources are skipped and Lambdas will reject every request (no dev-user fallback)."
  type        = bool
  default     = true
}
