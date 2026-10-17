# ADR-014: Extend TTL as a tag change, cost as a static estimate

## Status
Accepted (amends ADR-012: the portal is no longer strictly read-only)

## Context
Users need more time sometimes, and the portal should show what an environment costs.

## Decision
- Extend TTL rewrites the expires-at tag on the environment's VPC and instances. The portal's
  AWS identity gains one narrow write: ec2:CreateTags for the key expires-at on resources tagged
  project=eaas. The remaining time after an extension cannot exceed 4 hours.
- Cost is estimated from a small price table (EC2 on-demand t3 prices for ap-south-1, plus
  approximate IPv4 and EBS charges) and the instance launch time. It is labelled an estimate.

## Alternatives considered
- Extend through a Jenkins job and Terraform: slow and heavy for a tag change.
- The Cost Explorer API: needs enabling, costs money per call, and lags by a day.
- No cap on extensions: one click could keep an environment alive indefinitely.

## Reason
Smallest permission and the fewest moving parts that deliver the behaviour.

## Consequences
- Other resources keep the original expires-at value, so Terraform shows tag drift; destroy ignores it.
- The estimate ignores data transfer and taxes, and the table must be updated if prices change.
- Repeated extensions are possible as long as each stays inside the 4-hour remaining cap.
