# ADR-015: Failure injection as a measured Jenkins job

## Status
Accepted

## Context
The project must show that the platform detects failures and recovers, with measured
times, and the portal must be able to trigger the failures.

## Decision
- A Jenkins job (eaas-inject) runs scripts/inject-failure.sh. The portal triggers it through
  the Jenkins API and reads the archived recovery.json; the SSH key never leaves Jenkins.
- Five failures: pod-kill, service-crash, node-kill, cpu-spike, disk-fill. Medium environments
  only (two nodes, monitoring).
- Detection and recovery are defined per failure and stored with each result. Recovery is
  only evaluated after detection. Self-healing faults are measured until the platform recovers;
  time-boxed pressure faults (cpu, disk) are reverted by the test and measured until the signal clears.
- A once-per-second probe through the frontend counts failed requests as the user would see them.
- Each run is annotated on the environment's Grafana dashboard.
- Preflight refuses to inject into an unhealthy environment, and an exit trap always reverts the fault.

## Alternatives considered
- Ansible playbooks or SSM actions: per-task overhead blurs second-level timings; SSM was ruled out in ADR-004.
- SSH keys in the portal: widens the blast radius of a local web app.
- Chaos Mesh: the right tool in a larger cluster, but heavier than this lab needs.

## Reason
Reuses the Jenkins credentials and tooling, keeps the portal small, and produces comparable numbers.

## Consequences
- Measurement resolution is about 1-3 seconds (polling), good for minutes, rough for a pod restart.
- Node replacement is not implemented (no Auto Scaling group); the node is restarted by the test.
- A destroy or TTL expiry during an injection is not blocked; cleanup is best-effort.
- The portal can only start jobs; it cannot change what a failure does.
