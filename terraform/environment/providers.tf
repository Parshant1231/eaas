terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Bucket, region and locking come from backend.hcl; the key is passed at init
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project     = "eaas"
      managed-by  = "terraform"
      env-id      = var.env_id
      owner       = var.owner
      ttl-hours   = tostring(var.ttl_hours)
      expires-at  = var.expires_at
      cost-center = var.cost_center
    }
  }
}
