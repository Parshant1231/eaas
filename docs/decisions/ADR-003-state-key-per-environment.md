# ADR-003: One root config, one state key per environment

## Status
Accepted

## Context
Every environment is the same code with different inputs. State must never be
shared between environments, or destroying one could touch another.

## Decision
A single terraform/environment/ config. The pipeline passes the state key at
init: envs/<env-id>/terraform.tfstate.

## Alternatives considered
- Terraform workspaces: implicit state selection that is easy to get wrong.
- A folder per environment: copy-pasted code, defeats the point of EaaS.

## Reason
Explicit, inspectable, and the pipeline can choose the key per request.

## Consequences
- Switching environments locally needs terraform init -reconfigure.
- Cleanup can list and verify state keys in S3.
