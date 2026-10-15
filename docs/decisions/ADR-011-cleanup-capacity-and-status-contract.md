# ADR-011: Cleanup on failure, capacity by VPC tags, status.json contract

## Status
Accepted

## Context
Failed builds must not leave billing resources, concurrent creates must respect the
3-environment cap, and the future portal needs a stable way to read results.

## Decision
- Once Terraform apply is about to start, any non-success build runs terraform destroy
  from remote state, then verifies nothing is left.
- Capacity and duplicate checks count VPCs tagged project=eaas, inside a Jenkins lock
  shared with the Terraform apply.
- Each build writes status.json (result, urls, expiry, creation time, cleanup outcome)
  as an artifact.

## Alternatives considered
- Keep failed environments for debugging: risks silent cost.
- Count instances for capacity: wider race window than VPCs.
- A DynamoDB counter: extra resource for a lab-sized limit.

## Reason
Uses AWS tags and remote state as the source of truth, with no extra infrastructure.

## Consequences
- A hard-killed Jenkins skips cleanup; the Phase 7 TTL Lambda is the backstop.
- Create and destroy for the same environment serialize on the Terraform state lock.
- A failed environment is gone, so debugging relies on build logs.
