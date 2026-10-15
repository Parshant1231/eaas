terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Bucket and key come from -backend-config at init
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project    = "eaas"
      component  = "pipeline-iam"
      managed-by = "terraform"
    }
  }
}

data "aws_iam_policy_document" "pipeline" {
  statement {
    sid       = "Ec2Describe"
    actions   = ["ec2:Describe*"]
    resources = ["*"]
  }

  statement {
    sid = "Ec2CreateAndModify"
    actions = [
      "ec2:CreateVpc",
      "ec2:ModifyVpcAttribute",
      "ec2:CreateSubnet",
      "ec2:ModifySubnetAttribute",
      "ec2:CreateInternetGateway",
      "ec2:AttachInternetGateway",
      "ec2:CreateRouteTable",
      "ec2:CreateRoute",
      "ec2:AssociateRouteTable",
      "ec2:CreateSecurityGroup",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:ModifySecurityGroupRules",
      "ec2:ImportKeyPair",
      "ec2:RunInstances",
      "ec2:CreateTags",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }
  }

  statement {
    sid = "Ec2DeleteOnlyEaasTagged"
    actions = [
      "ec2:TerminateInstances",
      "ec2:DeleteVpc",
      "ec2:DeleteSecurityGroup",
      "ec2:DeleteKeyPair",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "ec2:ResourceTag/project"
      values   = ["eaas"]
    }
  }

  statement {
    sid = "Ec2TeardownAndRevoke"
    actions = [
      "ec2:DeleteSubnet",
      "ec2:DeleteInternetGateway",
      "ec2:DetachInternetGateway",
      "ec2:DeleteRouteTable",
      "ec2:DeleteRoute",
      "ec2:DisassociateRouteTable",
      "ec2:RevokeSecurityGroupIngress",
      "ec2:RevokeSecurityGroupEgress",
      "ec2:DeleteTags",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }
  }

  statement {
    sid       = "StateBucketList"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.state_bucket_name}"]
  }

  statement {
    sid       = "EnvironmentStateObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.state_bucket_name}/envs/*"]
  }

  statement {
    sid       = "UbuntuAmiParameter"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.region}::parameter/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"]
  }
}

resource "aws_iam_policy" "pipeline" {
  name   = "eaas-jenkins-pipeline"
  policy = data.aws_iam_policy_document.pipeline.json
}

resource "aws_iam_user" "pipeline" {
  name = "eaas-jenkins"
}

resource "aws_iam_user_policy_attachment" "pipeline" {
  user       = aws_iam_user.pipeline.name
  policy_arn = aws_iam_policy.pipeline.arn
}

data "aws_iam_policy_document" "portal" {
  statement {
    sid       = "ReadEnvironmentState"
    actions   = ["ec2:DescribeVpcs", "ec2:DescribeInstances"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "portal" {
  name   = "eaas-portal-readonly"
  policy = data.aws_iam_policy_document.portal.json
}

resource "aws_iam_user" "portal" {
  name = "eaas-portal"
}

resource "aws_iam_user_policy_attachment" "portal" {
  user       = aws_iam_user.portal.name
  policy_arn = aws_iam_policy.portal.arn
}
