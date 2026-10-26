# System architecture

See architecture-diagram.md for the diagrams. This page explains each component.

| Component | Responsibility | Where its state lives | If it fails |
|-----------|----------------|-----------------------|-------------|
| Portal (Node.js/TypeScript) | Validates requests, enforces the cap, triggers Jenkins, lists environments, extends TTLs | Nowhere: derives everything from AWS tags and the Jenkins API | Restart it; nothing is lost |
| Jenkins (Docker, local) | Runs create, destroy, inject and security pipelines | Jenkins volume; Terraform state in S3 | No pipeline actions; the Lambda still terminates expired instances |
| Terraform | VPC, nodes, tags, IAM, guardrails | S3 bucket, one key per environment, native locking | Plan or apply stops; failed builds destroy and verify |
| Ansible | Hardening, k3s, node_exporter, idempotent | The nodes themselves | Re-run converges; Jenkins retries the stage |
| k3s + Helm | Runs the sample app and monitoring | The cluster | Probes and Deployments recover pods; node loss is rescheduled |
| Prometheus + Grafana | Metrics, NodeDown and HighCpu alerts, per-environment dashboard | Ephemeral (6h retention) | App keeps running; visibility is lost |
| TTL reaper (Lambda + EventBridge + SQS) | Finds expired environments, requests destroy, terminates as a last resort | AWS tags | Errors and not-running alarms email you |
| Failure injection | Breaks one thing and measures detection and recovery | recovery.json per Jenkins build | Exit trap always reverts the fault |
| Security scans | Gate Terraform, images and secrets before provisioning | Reports archived per build | Fails closed: creation stops |

## Data flow in one paragraph
A request enters the portal, which validates it, checks the cap and triggers Jenkins. Jenkins scans, provisions
with Terraform, configures nodes with Ansible, deploys with Helm and smoke tests. The portal reads the live state
from AWS tags and the Jenkins API. At expiry the Lambda requests a destroy through SQS; the portal re-checks the
expiry in AWS before triggering the destroy job; after a grace period the Lambda terminates instances itself.

## Trust boundaries
- Browser to portal: localhost only, Host/Origin/header checks, strict Content Security Policy.
- Portal to AWS: read-only describe, SQS receive and one tag key write.
- Pipeline to AWS: scoped IAM user (region lock, tag-scoped deletes, state limited to envs/*).
- Operator to nodes: SSH and the Kubernetes API from one /32 only.
