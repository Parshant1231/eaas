# ADR-005: No separate Docker runtime on nodes

## Status
Accepted

## Context
The original spec listed Docker/containerd on the nodes.

## Decision
Rely on the containerd runtime bundled with k3s. Do not install Docker on nodes.

## Alternatives considered
- Install Docker alongside k3s: more RAM, more attack surface.
- k3s with --docker: deprecated path.

## Reason
Nothing on a node builds images; images are built and scanned in the pipeline.

## Consequences
- Use crictl or k3s kubectl on nodes, not docker.
- One less package to patch.
