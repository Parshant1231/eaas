# ADR-016: Resilience tuning of the sample app and monitoring placement

## Status
Accepted

## Context
Failure injection should measure a platform that is designed to recover, not an accident of
default scheduling. With defaults, replicas can all land on one node and Kubernetes waits
five minutes before moving pods off a lost node.

## Decision
- PostgreSQL, Prometheus, Grafana, kube-state-metrics and the operator are pinned to the server
  node (control-plane label). PostgreSQL has node-local storage and a single replica, so it cannot
  move; monitoring staying on the server means losing the worker never blinds the observer.
- API and frontend spread across nodes with a topology spread constraint (ScheduleAnyway).
- Frontend runs two replicas (the API already runs two or more through its HPA).
- Pods tolerate the unreachable and not-ready taints for 30 seconds instead of 300.

## Alternatives considered
- Defaults: node-loss recovery would take over five minutes and measure Kubernetes defaults.
- A replicated PostgreSQL: a different project; it stays a documented single point of failure.
- Hard anti-affinity: would leave pods Pending on a single-node environment.

## Reason
Recovery is real and bounded by tunable settings, and the test results mean something.

## Consequences
- Losing the server node takes out PostgreSQL and monitoring; this is not tested and is listed as a limitation.
- A short network blip longer than 30 seconds can cause a needless pod reschedule.
- Small (single-node) environments are unaffected, they simply run two replicas on one node.
