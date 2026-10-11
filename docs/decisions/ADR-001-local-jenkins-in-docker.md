# ADR-001: Run Jenkins locally in Docker

## Status
Accepted

## Context
EaaS needs an orchestrator that runs Terraform, Ansible and Helm per environment.

## Decision
Run the Jenkins controller on my machine via Docker Compose, with the UI bound
to localhost only.

## Alternatives considered
- Jenkins on an always-on EC2 instance: reachable from AWS (Lambda), but costs
  money continuously and needs its own hardening.
- GitHub Actions: not what the project specifies, and less relevant for
  showing Jenkins pipeline skills.

## Reason
Zero running cost, one-command reproducible setup, enough for a portfolio.

## Consequences
- AWS-side components (the TTL Lambda) cannot call Jenkins directly. Phase 7
  uses a queue plus a last-resort terminate path instead.
- Pipeline-driven destroy only works while my machine is on
- Ansible reaches EC2 from my own network (SSH vs SSM decided in Phase 3).
