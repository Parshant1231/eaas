# ADR-009: Custom Jenkins image with a pinned toolchain

## Status
Accepted

## Context
The pipeline needs Terraform, AWS CLI, Ansible, kubectl and Helm available to Jenkins.

## Decision
Build an image from the official Jenkins LTS image. Tool versions come from the
versions used on the developer machine (Terraform, AWS CLI, Helm), kubectl from
the pinned k3s version, and Ansible from ansible/requirements.txt. Terraform,
kubectl and Helm downloads are checksum verified.

## Alternatives considered
- Docker agents per stage via the host Docker socket: gives every job root-equivalent
  access to the host.
- Install tools on the host and use an SSH agent: harder to reproduce.

## Reason
Reproducible, version-controlled toolchain with no extra host access.

## Consequences
- Large image; rebuild when versions change (scripts/build-jenkins-image.sh).
- Builds run on the controller, which is acceptable for a local lab but not for production.
- AWS CLI download and Jenkins plugins are not pinned or verified.
