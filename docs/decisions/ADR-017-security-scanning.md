# ADR-017: Security scanning with Checkov and Trivy, fail closed

## Status
Accepted

## Context
The project requires scanning in the pipeline for Terraform and images, and must not leak secrets.

## Decision
- Checkov scans the Terraform used by every environment. Skips live in one file (.checkov.yaml), each with a reason.
- Trivy scans our images and the working tree for secrets. Only fixable CRITICAL vulnerabilities block creation.
- A repository audit checks tracked files, patterns, history and .gitignore.
- The create pipeline runs the scans before the capacity check and Terraform, so a failed scan creates nothing.
- Everything else (HIGH findings, third-party images, chart and Dockerfile misconfigurations, bootstrap roots)
  is reported, not blocking.
- Tool versions are pinned and the Trivy download is checksum verified.

## Alternatives considered
- tfsec: being folded into Trivy by its maintainers; Checkov is actively maintained.
- Gating on all severities: new upstream CVEs would block every build with nothing I can fix.
- Scanning only in GitHub Actions: does not cover Terraform at provision time.

## Reason
A gate that fails for reasons I cannot act on gets switched off; a gate on what I control stays on.

## Consequences
- If the vulnerability database cannot be fetched, creation stops (fail closed).
- Images are scanned after publication, not before the push.
- Skips need a written reason and must stay in sync with docs/security/scan-results.md.
