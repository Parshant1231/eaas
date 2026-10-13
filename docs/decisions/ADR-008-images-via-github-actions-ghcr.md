# ADR-008: Build app images with GitHub Actions into GHCR

## Status
Accepted

## Context
Nodes need container images for the sample app, and no secrets may be hardcoded.

## Decision
GitHub Actions builds both images on changes under app/ and pushes them to GHCR using
the short-lived GITHUB_TOKEN. Packages are public so nodes pull without credentials.

## Alternatives considered
- Docker Hub with a stored access token: a long-lived secret to protect.
- Importing images over SSH: not repeatable by a pipeline.

## Reason
No stored credentials, free for public repos, and gives a real CI story.

## Consequences
- Making packages public is a one-time manual click (not infrastructure as code).
- Tag 0.1.0 is mutable; the commit SHA tag provides traceability.
- Actions are pinned to major versions, not commit SHAs.
