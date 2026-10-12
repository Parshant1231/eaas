# ADR-004: SSH (not SSM) for Ansible connectivity

## Status
Accepted

## Context
Ansible must reach freshly created EC2 nodes from my machine / local Jenkins.

## Decision
Connect over SSH using the public IP, with port 22 limited to my IP /32 and
an ed25519 key kept outside the repo.

## Alternatives considered
- SSM Session Manager: no inbound port, but needs an IAM instance profile, an
  S3 bucket for file transfer and the Session Manager plugin.
- Bastion host: extra instance and cost.

## Reason
Simplest option that keeps SSH locked to one address.

## Consequences
- If my ISP changes my IP, access breaks until the CIDR is updated.
- Host key checking is disabled because nodes are short-lived and public IPs
  are reused; this accepts a MITM risk and is listed under Known limitations.
- SSM is a documented future improvement.
