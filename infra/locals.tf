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

  # True when Cognito resources should exist: any real AWS account, OR when
  # the operator explicitly opted in (LocalStack Pro). See var.enable_cognito.
  cognito_enabled = data.aws_caller_identity.this.id != "000000000000" || var.enable_cognito

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
      # installs into each service dir for LocalStack hot-reload) from the AWS
      # deployment zip. The Lambda module reinstalls them fresh via
      # build_in_docker + pip_requirements, so shipping the local copies would
      # be redundant and could mask Linux/x86_64 wheel mismatches if the dev
      # ran pip on a non-Lambda platform.
      patterns = [
        "!__pycache__/.*",
        "!\\..*",
        "!annotated_types/.*",
        "!annotated_types-.*\\.dist-info/.*",
        "!cffi/.*",
        "!cffi-.*\\.dist-info/.*",
        "!_cffi_backend.*\\.so",
        "!cryptography/.*",
        "!cryptography-.*\\.dist-info/.*",
        "!jwt/.*",
        "!PyJWT-.*\\.dist-info/.*",
        "!psycopg/.*",
        "!psycopg-.*\\.dist-info/.*",
        "!psycopg_binary/.*",
        "!psycopg_binary-.*\\.dist-info/.*",
        "!psycopg_binary\\.libs/.*",
        "!pycparser/.*",
        "!pycparser-.*\\.dist-info/.*",
        "!pydantic/.*",
        "!pydantic-.*\\.dist-info/.*",
        "!pydantic_core/.*",
        "!pydantic_core-.*\\.dist-info/.*",
        "!typing_extensions\\.py",
        "!typing_extensions-.*\\.dist-info/.*",
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
    # Local: resolves to the `postgres` service on the shared "coding-workshop"
    # docker network (see docker-compose.yml + LAMBDA_DOCKER_NETWORK). AWS: RDS
    # endpoint. var.aws_postgres_host remains an override hatch for unusual
    # local topologies.
    POSTGRES_HOST        = data.aws_caller_identity.this.id == "000000000000" ? coalesce(try(trimspace(var.aws_postgres_host), ""), "postgres") : try(element(aws_rds_cluster.this.*.endpoint, 0), "")
    POSTGRES_PORT        = data.aws_caller_identity.this.id == "000000000000" ? "5432" : try(element(aws_rds_cluster.this.*.port, 0), "")
    POSTGRES_NAME        = data.aws_caller_identity.this.id == "000000000000" ? "postgres" : try(element(aws_rds_cluster.this.*.database_name, 0), "")
    POSTGRES_USER        = data.aws_caller_identity.this.id == "000000000000" ? "postgres" : try(element(aws_rds_cluster.this.*.master_username, 0), "")
    POSTGRES_PASS        = data.aws_caller_identity.this.id == "000000000000" ? "postgres123" : try(element(aws_rds_cluster.this.*.master_password, 0), "")
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
  }
  iam_arns = [
    format("arn:%s:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole", data.aws_partition.this.partition),
  ]
}
