locals {
  app_id = try(trimspace(var.aws_app_code), "") != "" ? trimspace(var.aws_app_code) : random_id.this.hex
  app_tags = merge(
    try(element(data.aws_servicecatalogappregistry_application.this.*.application_tag, 0), {}),
    { participant = local.app_id, event = random_id.this.hex }
  )
  public_route_table_ids = [
    for rt in data.aws_route_table.this :
    rt.id if length([for route in rt.routes : route if startswith(route.gateway_id, "igw-")]) > 0
  ]
  public_subnet_ids = sort(distinct(flatten([
    for rt_id in local.public_route_table_ids : [
      for assoc in data.aws_route_table.this[rt_id].associations :
      assoc.subnet_id if assoc.subnet_id != ""
    ]
  ])))
  private_subnet_ids = sort(tolist(setsubtract(data.aws_subnets.this.ids, local.public_subnet_ids)))

  # True when Cognito resources should be provisioned. var.enable_cognito is
  # authoritative on both real AWS and LocalStack so participants can disable
  # Cognito when their assumed role lacks cognito-idp:CreateUserPool perms.
  cognito_enabled = var.enable_cognito

  # Auto-discover Python Lambda services (SYSTEM_DESIGN §0). One level deep;
  # underscore-prefixed dirs (_lib, _db, _examples) are excluded. Java and
  # Node.js discovery removed per Appendix B.
  python_dirs = [
    for file in fileset(format("%s/../backend", path.module), "*/function.py") :
    dirname(file) if !startswith(dirname(file), "_") && !startswith(dirname(file), ".")
  ]
  python_names = {
    for name in local.python_dirs : name => {
      name    = name
      arch    = "x86_64"
      runtime = "python3.11"
      handler = "function.handler"
      path    = abspath(format("%s/../backend/%s", path.module, name))
      # Exclude pip-install artifacts (vendored deps that bin/start-dev.sh
      # installs into each service dir for LocalStack hot-reload). The Lambda
      # module reinstalls them fresh via build_in_docker + pip_requirements,
      # so shipping the local copies would mask Linux/x86_64 wheel mismatches.
      # Patterns are gitignore-style; `!` excludes. Generic wildcards catch
      # all dist-info dirs, hidden files, pycache, and compiled extensions;
      # the named-package list covers top-level vendored package dirs.
      patterns = [
        "!__pycache__/.*",
        "!\\..*",
        "!.*\\.dist-info/.*",
        "!.*\\.so",
        "!annotated_types/.*",
        "!cffi/.*",
        "!cryptography/.*",
        "!jwt/.*",
        "!psycopg/.*",
        "!psycopg_binary/.*",
        "!psycopg_binary\\.libs/.*",
        "!pycparser/.*",
        "!pydantic/.*",
        "!pydantic_core/.*",
        "!typing_extensions\\.py",
      ]
      pip_requirements = true
    }
  }

  # v1 is Python-only.
  function_names = local.python_names

  function_origins = [
    for name, func in local.function_names : {
      name        = func.name
      origin_id   = format("lambda-%s", func.name)
      domain_name = replace(replace(module.lambda[name].lambda_function_url, "https://", ""), "/", "")
    }
  ]
  origin_id = format("%s-s3-origin-%s", var.aws_project, local.app_id)

  # CORS allow-list passed to every Lambda. We intentionally do NOT reference
  # aws_cloudfront_distribution.this here: CloudFront's origins are the Lambda
  # Function URLs, so reading its domain back into the Lambda env vars would
  # create a graph cycle (lambda -> env_vars -> cors -> cloudfront -> lambda).
  # Instead, allow localhost for Vite dev and "*" for the deployed environment;
  # the Lambda handlers reflect the request Origin in their CORS responses.
  cors_allowed_origins = join(",", compact([
    "http://localhost:3000",
    data.aws_caller_identity.this.id != "000000000000" ? "*" : "",
  ]))

  env_vars = {
    APP_ID     = local.app_id
    APP_NAME   = format("%s-%s", var.aws_project, local.app_id)
    APP_ROLE   = format("arn:%s:iam::%s:role/%s-assume-%s-%s", data.aws_partition.this.partition, data.aws_caller_identity.this.account_id, var.aws_project, data.aws_region.this.region, local.app_id)
    APP_REGION = data.aws_region.this.region
    # ── PostgreSQL connection ───────────────────────────────────────────────────
    # When aws_postgres_enabled = true (default), every environment uses Aurora:
    #   • LocalStack Pro: Aurora is provisioned by Terraform in LocalStack. Lambda
    #     containers reach it via "workshop-localstack" (the Docker container name
    #     on the "coding-workshop" network) rather than via the cluster DNS — the
    #     DNS suffix *.rds.localhost.localstack.cloud resolves to 127.0.0.1, which
    #     is the Lambda container itself, not LocalStack. Same pattern as
    #     COGNITO_JWKS_URL above.
    #   • Real AWS: standard Aurora cluster writer endpoint.
    # When aws_postgres_enabled = false (LocalStack Community / no-RDS mode), the
    # plain postgres:17 Docker container is used instead.
    POSTGRES_HOST = var.aws_postgres_enabled ? (
      data.aws_caller_identity.this.id == "000000000000"
      ? "workshop-localstack"
      : try(element(aws_rds_cluster.this.*.endpoint, 0), "")
    ) : coalesce(try(trimspace(var.aws_postgres_host), ""), "postgres")
    POSTGRES_PORT        = var.aws_postgres_enabled ? tostring(try(element(aws_rds_cluster.this.*.port, 0), 5432)) : "5432"
    POSTGRES_NAME        = var.aws_postgres_enabled ? try(element(aws_rds_cluster.this.*.database_name, 0), replace(var.aws_project, "-", "")) : "postgres"
    POSTGRES_USER        = var.aws_postgres_enabled ? try(element(aws_rds_cluster.this.*.master_username, 0), "superadmin") : "postgres"
    POSTGRES_PASS        = var.aws_postgres_enabled ? try(element(aws_rds_cluster.this.*.master_password, 0), "") : "postgres123"
    COGNITO_USER_POOL_ID = local.cognito_enabled ? try(element(aws_cognito_user_pool.this.*.id, 0), "") : ""
    COGNITO_CLIENT_ID    = local.cognito_enabled ? try(element(aws_cognito_user_pool_client.this.*.id, 0), "") : ""
    # COGNITO_ISSUER_URL must match the `iss` claim that the IdP actually puts
    # in tokens. LocalStack stamps tokens with
    #   iss = http://localhost.localstack.cloud:4566/<pool_id>
    # — NOT the AWS-style cognito-idp.<region>.amazonaws.com URL — so we
    # branch on the account id to pick the right one.
    COGNITO_ISSUER_URL = local.cognito_enabled ? (
      data.aws_caller_identity.this.id == "000000000000"
      ? try(format("http://localhost.localstack.cloud:4566/%s", element(aws_cognito_user_pool.this.*.id, 0)), "")
      : try(format("https://cognito-idp.%s.amazonaws.com/%s", data.aws_region.this.region, element(aws_cognito_user_pool.this.*.id, 0)), "")
    ) : ""
    # COGNITO_JWKS_URL is fetched FROM INSIDE the Lambda container. On
    # LocalStack `localhost.localstack.cloud` resolves to 127.0.0.1, which is
    # the container itself — not LocalStack — so we must use the docker-network
    # hostname `workshop-localstack` instead. On AWS the JWKS URL just hangs
    # off the issuer like normal.
    COGNITO_JWKS_URL = local.cognito_enabled ? (
      data.aws_caller_identity.this.id == "000000000000"
      ? try(format("http://workshop-localstack:4566/%s/.well-known/jwks.json", element(aws_cognito_user_pool.this.*.id, 0)), "")
      : try(format("https://cognito-idp.%s.amazonaws.com/%s/.well-known/jwks.json", data.aws_region.this.region, element(aws_cognito_user_pool.this.*.id, 0)), "")
    ) : ""
    CORS_ALLOWED_ORIGINS = local.cors_allowed_origins
    # DEV-ONLY auth bypass — see variable.tf:enable_dev_auth_bypass. Passed as
    # "true"/"" rather than bool so the Lambda env preserves the off-state as
    # an unset-looking empty string.
    AUTH_DEV_BYPASS = var.enable_dev_auth_bypass ? "true" : ""
    # Shared plaintext password the dev-auth bypass compares against. See
    # variable.tf:workshop_password — leak this and admin access leaks with it.
    WORKSHOP_PASSWORD = var.workshop_password
  }
  iam_arns = [
    format("arn:%s:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole", data.aws_partition.this.partition),
  ]
}
