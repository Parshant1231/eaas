# ADR-002: Native S3 state locking instead of DynamoDB

## Status
Accepted

## Context
Terraform state must be remote and locked so two runs cannot corrupt it. The
original design used S3 + DynamoDB. Terraform 1.11+ supports native S3 locking
(use_lockfile) and the DynamoDB lock option is deprecated.

## Decision
Store state in a versioned, encrypted, private S3 bucket and lock with
use_lockfile = true.

## Alternatives considered
- S3 + DynamoDB table: widely seen in existing codebases, but an extra
  resource and a deprecated path.
- Local state: lost with the laptop and unusable from a pipeline.

## Reason
Fewer moving parts and the current recommended approach.

## Consequences
- Requires Terraform >= 1.11 (pinned in required_version).
- Anyone reading older tutorials will see DynamoDB; this ADR explains why we
  did not.
