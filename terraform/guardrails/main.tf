terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
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
      component  = "guardrails"
      managed-by = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

# Destroy requests from the reaper to the portal. Messages are only hints:
# the reaper re-sends every run until the environment is gone.
resource "aws_sqs_queue" "destroy_requests" {
  name                       = "eaas-destroy-requests"
  message_retention_seconds  = 86400
  visibility_timeout_seconds = 60
  sqs_managed_sse_enabled    = true
}

data "archive_file" "reaper" {
  type        = "zip"
  source_file = "${path.module}/../../lambda/ttl-reaper/reaper.py"
  output_path = "${path.module}/.build/ttl-reaper.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "reaper" {
  name               = "eaas-ttl-reaper"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_cloudwatch_log_group" "reaper" {
  name              = "/aws/lambda/eaas-ttl-reaper"
  retention_in_days = 7
}

data "aws_iam_policy_document" "reaper" {
  statement {
    sid       = "DescribeEnvironments"
    actions   = ["ec2:DescribeVpcs", "ec2:DescribeInstances"]
    resources = ["*"]
  }

  statement {
    sid       = "TerminateOnlyEaasInstances"
    actions   = ["ec2:TerminateInstances"]
    resources = ["arn:aws:ec2:${var.region}:${data.aws_caller_identity.current.account_id}:instance/*"]

    condition {
      test     = "StringEquals"
      variable = "ec2:ResourceTag/project"
      values   = ["eaas"]
    }
  }

  statement {
    sid       = "SendDestroyRequests"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.destroy_requests.arn]
  }

  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.reaper.arn}:*"]
  }
}

resource "aws_iam_role_policy" "reaper" {
  name   = "eaas-ttl-reaper"
  role   = aws_iam_role.reaper.id
  policy = data.aws_iam_policy_document.reaper.json
}

resource "aws_lambda_function" "reaper" {
  function_name    = "eaas-ttl-reaper"
  role             = aws_iam_role.reaper.arn
  runtime          = "python3.12"
  handler          = "reaper.handler"
  filename         = data.archive_file.reaper.output_path
  source_code_hash = data.archive_file.reaper.output_base64sha256
  timeout          = 60
  memory_size      = 128

  environment {
    variables = {
      QUEUE_URL     = aws_sqs_queue.destroy_requests.url
      GRACE_MINUTES = tostring(var.grace_minutes)
      DRY_RUN       = tostring(var.reaper_dry_run)
    }
  }

  depends_on = [aws_cloudwatch_log_group.reaper, aws_iam_role_policy.reaper]
}

resource "aws_cloudwatch_event_rule" "every_five_minutes" {
  name                = "eaas-ttl-reaper-schedule"
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "reaper" {
  rule = aws_cloudwatch_event_rule.every_five_minutes.name
  arn  = aws_lambda_function.reaper.arn
}

resource "aws_lambda_permission" "from_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reaper.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.every_five_minutes.arn
}
