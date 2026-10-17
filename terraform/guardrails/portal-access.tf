# Extra permissions for the portal user created in terraform/pipeline-iam:
# read destroy requests, and move the expiry of eaas-tagged resources (nothing else).
data "aws_iam_policy_document" "portal_ttl" {
  statement {
    sid       = "ReceiveDestroyRequests"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage"]
    resources = [aws_sqs_queue.destroy_requests.arn]
  }

  statement {
    sid     = "ExtendTtlTagOnly"
    actions = ["ec2:CreateTags"]
    resources = [
      "arn:aws:ec2:${var.region}:${data.aws_caller_identity.current.account_id}:vpc/*",
      "arn:aws:ec2:${var.region}:${data.aws_caller_identity.current.account_id}:instance/*",
    ]

    condition {
      test     = "StringEquals"
      variable = "ec2:ResourceTag/project"
      values   = ["eaas"]
    }

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "aws:TagKeys"
      values   = ["expires-at"]
    }
  }
}

resource "aws_iam_policy" "portal_ttl" {
  name   = "eaas-portal-ttl"
  policy = data.aws_iam_policy_document.portal_ttl.json
}

resource "aws_iam_user_policy_attachment" "portal_ttl" {
  user       = "eaas-portal"
  policy_arn = aws_iam_policy.portal_ttl.arn
}
