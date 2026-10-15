# ADR-012: Stateless, local-only portal reading AWS and Jenkins

## Status
Accepted

## Context
The portal must list environments with live status, show build progress and logs, and
trigger create and destroy. It can create paid resources, so it must not be reachable
by other sites or machines.

## Decision
- No database. Existence comes from AWS (VPC and instance tags), progress and failures
  from the Jenkins API. A pure function merges them into one state per environment.
- Bind to 127.0.0.1 and reject unknown Host headers, cross-site Origins and mutations
  without a custom header. No CORS.
- Read-only AWS identity (describe VPCs and instances) via a required AWS_PROFILE.
- Plain HTML/CSS/JS with a strict Content Security Policy; dynamic values are only
  written with textContent.
- The portal sends only ENV_NAME, SIZE, TTL_HOURS and OWNER, so the FAIL_AT test hook
  cannot be triggered from it.

## Alternatives considered
- A database of environments: a second source of truth that can drift from AWS.
- Reading only status.json artifacts: written at the end of a build, so it is blind to
  in-progress builds and to environments removed outside the pipeline.
- React with a build step: more tooling and attack surface for a small page.
- Login and sessions: out of scope for a single-user local lab.

## Consequences
- State is always as fresh as the 5-second poll, and restarts lose nothing.
- No authentication: anyone with access to this machine's localhost can use it.
- The Jenkins API token belongs to a full user; a dedicated limited Jenkins user is a
  future improvement.
- Extend TTL, cost estimates and failure injection are added in later phases.
