# ADR-007: Trimmed kube-prometheus-stack scraping the host node_exporter

## Status
Accepted

## Context
The full stack is heavy for 4 GB nodes and several default components do not
apply to k3s (embedded scheduler, controller manager, etcd). Phase 3 already
installs node_exporter as a systemd service on port 9100.

## Decision
Disable the chart's node-exporter DaemonSet, default alert rules and Alertmanager.
Prometheus discovers nodes through Kubernetes and scrapes the host exporters.
Ship two explicit alerts (NodeDown, HighCpu) and a templated per-environment dashboard.

## Alternatives considered
- Keep chart defaults: port 9100 conflict, constant false alerts, more RAM.
- Run Prometheus outside the cluster: needs network paths into every environment.

## Reason
Fits the hardware, keeps host-level metrics independent of cluster health, and
gives exactly the alerts the project needs.

## Consequences
- Alerts are visible in Prometheus and Grafana but no notifications are sent.
- Monitoring requires the medium size (small environments run the app only).
- Operator admission webhooks are disabled, so invalid rules are not rejected at apply time.
