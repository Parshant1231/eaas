# ADR-006: NodePort access instead of an ingress controller

## Status
Accepted

## Context
Each environment needs two stable URLs (sample app, Grafana) for the portal.

## Decision
Disable Traefik and servicelb in k3s. Expose the frontend on NodePort 30080 and
Grafana on 30300, reachable only from the operator IP via security group rules.
Prometheus stays ClusterIP and is reached with kubectl port-forward.

## Alternatives considered
- Traefik ingress with path routing: more moving parts (Grafana sub-path config,
  TLS), more memory on small nodes.
- LoadBalancer services: not available without a cloud load balancer and costs money.

## Reason
Simplest stable URLs with the smallest attack surface and no extra components.

## Consequences
- Plain HTTP, no TLS (listed under Known limitations).
- Port numbers are fixed per environment, which is fine because each environment
  has its own nodes.
