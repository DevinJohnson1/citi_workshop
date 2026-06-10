# Infrastructure (Terraform)
Single Terraform stack per participant. Provisions S3 (SPA), CloudFront (OAC
in front of S3 + each Lambda Function URL), Lambda (one per
`backend/<svc>/function.py`), Aurora Postgres Serverless v2, and a Cognito
user pool with Hosted UI. State lives in an S3 bucket the instructor
provisions once (`var.aws_bucket`).
## Files
| File             | Contents                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| `provider.tf`    | AWS + helper providers; S3 backend; default tags.                         |
| `data.tf`        | VPC/subnets/route tables/SGs lookups; caller identity / partition / region.|
| `locals.tf`      | Service discovery (`backend/*/function.py`); env vars for every Lambda.   |
| `variable.tf`    | `aws_project`, `aws_bucket`, `aws_app_code`, `aws_vpc_id`, `aws_postgres_*`. |
| `main.tf`        | `random_id` + `random_pet` (used for DB password).                        |
| `output.tf`      | CloudFront URL, S3 bucket, Lambda URLs, RDS endpoint/creds, Cognito IDs.  |
| `s3.tf`          | Private SPA bucket + LocalStack hot-reload bucket.                        |
| `cloudfront.tf`  | OAC, distribution, per-Lambda ordered_cache_behavior at `/api/<svc>*`.    |
| `lambda.tf`      | `module "lambda"` for each discovered service + DLQs + hot-reload trigger.|
| `rds.tf`         | Aurora PG Serverless v2 cluster (`min=0`, `max=4`, encrypted).            |
| `cognito.tf`     | User pool, app client (PKCE, no secret), Hosted UI domain.                |
| `policy.tftpl`   | Lambda IAM policy template (logs + DLQ access).                           |
## Critical invariants
- **CloudFront origin request policy must be `AllViewerExceptHostHeader`** on
  every `/api/<svc>*` behavior. `AllViewer` forwards `Host` and Lambda
  Function URLs reject it. Do not change.
- **Function URL `authorization_type = NONE`**. JWT validation is enforced
  in-handler (`backend/_lib/auth.py`). This is intentional, never disable the
  in-handler check.
- **Service discovery is `fileset(.../backend, "*/function.py")`.** Only one
  level deep; underscore-prefixed dirs are skipped. New services drop in by
  creating a folder -- no terraform edits required.
- **Cognito is AWS-only.** LocalStack doesn't ship Cognito on the Community
  tier; the user pool is `count = 0` when `aws_caller_identity.id ==
  "000000000000"`.
## Workflow
```bash
cd infra
terraform init -reconfigure -backend-config="bucket=$BUCKET" -backend-config="region=$AWS_REGION"
terraform validate
terraform plan
terraform apply
```
You normally don't run those by hand -- use `bin/deploy-backend.sh` which
also rsyncs `_lib/` into each service first.
## Outputs of interest
| Output                       | Usage                                            |
| ---------------------------- | ------------------------------------------------ |
| `cloudfront_distribution_url`| Live app URL (AWS only).                         |
| `cognito_issuer_url`         | Consumed by `_lib/auth.py` and the SPA.          |
| `rds_endpoint` / `rds_password` | Consumed by `bin/migrate.sh`.                 |
| `lambda_urls`                | Per-service Function URLs (used by local proxy). |
