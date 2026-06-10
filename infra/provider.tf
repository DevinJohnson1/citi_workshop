provider "aws" {
  default_tags {
    tags = {
      application = "coding-workshop"
      contact     = "github.com/eistrati"
      environment = terraform.workspace
    }
  }

  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_region_validation      = true
}

terraform {
  backend "s3" {
    # Placeholder values — the real bucket/region are injected at `terraform init`
    # time via `-backend-config` in bin/deploy-backend.sh, using the convention
    # `coding-workshop-tfstate-<PARTICIPANT_ID>` in the participant's AWS region.
    bucket = "coding-workshop-tfstate-abcd1234"
    key    = "terraform/terraform.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    external = {
      source  = "hashicorp/external"
      version = "~> 2.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  required_version = ">= 1.11.0"
}
