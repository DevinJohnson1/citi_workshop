module "lambda" {
  for_each = local.function_names
  source   = "terraform-aws-modules/lambda/aws"
  version  = "~> 8.0"

  function_name = format("%s-%s-%s", var.aws_project, each.value.name, local.app_id)
  package_type  = "Zip"
  architectures = [each.value.arch]
  handler       = each.value.handler
  runtime       = each.value.runtime
  memory_size   = 128
  timeout       = 300
  tracing_mode  = "PassThrough"
  # Build the deployment package inside the official AWS SAM build image for the
  # target runtime, so the host doesn't need a matching `python3.11` binary in
  # PATH. Without this, the module shells out to the host interpreter and fails
  # whenever the host Python (e.g. 3.12 / 3.13 / 3.14) differs from `runtime`.
  # NOTE: do NOT set `docker_image` here — that flag is interpreted as a tag
  # for `docker build` and requires `docker_build_root`/`docker_file`. Leaving
  # it unset makes the module `docker pull` + `docker run`
  # public.ecr.aws/sam/build-<runtime>:latest, which is what we actually want.
  build_in_docker = true
  store_on_s3     = data.aws_caller_identity.this.id != "000000000000"
  s3_bucket       = data.aws_caller_identity.this.id != "000000000000" ? aws_s3_bucket.this.id : null
  s3_prefix       = data.aws_caller_identity.this.id != "000000000000" ? format("lambda/%s/%s/", local.app_id, each.value.name) : null

  source_path = [{
    path             = try(each.value.path, null)
    patterns         = try(each.value.patterns, null)
    pip_requirements = try(each.value.pip_requirements, null)
    npm_requirements = try(each.value.npm_requirements, null)
  }]

  vpc_security_group_ids = data.aws_security_groups.this.ids
  vpc_subnet_ids         = local.public_subnet_ids
  attach_network_policy  = true

  create_package     = true
  create_role        = true
  role_name          = format("%s-%s-%s", var.aws_project, each.value.name, local.app_id)
  role_path          = "/service-role/"
  attach_policies    = true
  number_of_policies = length(local.iam_arns)
  policies           = local.iam_arns
  attach_policy_json = true
  policy_json        = templatefile("${path.module}/policy.tftpl", { app_id = local.app_id, app_name = var.aws_project })

  attach_cloudwatch_logs_policy     = true
  attach_dead_letter_policy         = true
  ephemeral_storage_size            = 512
  cloudwatch_logs_retention_in_days = 7
  cloudwatch_logs_skip_destroy      = false
  use_existing_cloudwatch_log_group = false
  trigger_on_package_timestamp      = false
  create_lambda_function_url        = true
  authorization_type                = "NONE"
  dead_letter_target_arn            = aws_sqs_queue.this[each.key].arn

  cors = {
    allow_credentials = false
    allow_headers     = ["*"]
    allow_methods     = ["*"]
    allow_origins     = ["*"]
    expose_headers    = []
    max_age           = 0
  }

  environment_variables = {
    for key, value in local.env_vars :
    key => trimspace(value) if try(trimspace(value), "") != ""
  }

  tags = local.app_tags
}

resource "aws_sqs_queue" "this" {
  for_each = local.function_names
  name     = format("%s-%s-dlq-%s", var.aws_project, each.value.name, local.app_id)

  sqs_managed_sse_enabled = true

  tags = local.app_tags
}

resource "null_resource" "hot_reload" {
  for_each = { for k, v in local.function_names : k => v if data.aws_caller_identity.this.id == "000000000000" }

  triggers = {
    source_code_hash = module.lambda[each.key].lambda_function_source_code_hash
  }

  provisioner "local-exec" {
    command = <<-EOT
      AWS_REGION=us-east-1 \
      AWS_ACCESS_KEY_ID=test \
      AWS_SECRET_ACCESS_KEY=test \
      AWS_ENDPOINT_URL=http://localhost:4566 \
      aws lambda update-function-code \
        --function-name ${module.lambda[each.key].lambda_function_name} \
        --s3-bucket hot-reload \
        --s3-key ${each.value.path}
    EOT
  }

  depends_on = [module.lambda, aws_s3_bucket.hot_reload]
}

