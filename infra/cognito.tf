# cognito.tf — Hosted UI user pool for the ACME Project Tracker.
#
# Skipped on LocalStack (account id "000000000000") because Cognito is a Pro
# feature; backend/_lib/auth.py short-circuits to a fixed dev user there.

resource "aws_cognito_user_pool" "this" {
  count                    = local.cognito_enabled ? 1 : 0
  name                     = format("%s-users-%s", var.aws_project, local.app_id)
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  tags = local.app_tags
}

# App client used by the React SPA (Authorization Code + PKCE, no client secret).
resource "aws_cognito_user_pool_client" "this" {
  count                                = local.cognito_enabled ? 1 : 0
  name                                 = format("%s-spa-%s", var.aws_project, local.app_id)
  user_pool_id                         = aws_cognito_user_pool.this[0].id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "profile", "email"]
  supported_identity_providers         = ["COGNITO"]

  # Callback / logout URL list. We intentionally do NOT reference
  # aws_cloudfront_distribution.this here: doing so creates a graph cycle
  # (lambda -> env_vars -> cognito_client -> cloudfront -> function_origins
  # -> lambda). After the first apply, rerun with
  #   terraform apply -var cloudfront_domain=$(terraform output -raw cloudfront_distribution_url)
  # to register the production callback URL.
  callback_urls = compact([
    "http://localhost:3000/login/callback",
    var.cloudfront_domain != "" ? format("https://%s/login/callback", var.cloudfront_domain) : "",
  ])
  logout_urls = compact([
    "http://localhost:3000/",
    var.cloudfront_domain != "" ? format("https://%s/", var.cloudfront_domain) : "",
  ])

  access_token_validity  = 60 # minutes
  id_token_validity      = 60 # minutes
  refresh_token_validity = 30 # days
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_PASSWORD_AUTH", # Workshop login form (bin/seed-cognito.sh + LoginPage.tsx).
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED"
}

# Hosted UI domain. Must be globally unique within the AWS region.
resource "aws_cognito_user_pool_domain" "this" {
  count        = local.cognito_enabled ? 1 : 0
  domain       = format("%s-%s", var.aws_project, local.app_id)
  user_pool_id = aws_cognito_user_pool.this[0].id
}

