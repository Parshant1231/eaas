# Environment-as-a-Service (EaaS)

## The problem
Developers wait days for ops to hand them an environment. Builds are manual
and inconsistent, nobody tracks cost, and forgotten environments keep billing.

## The solution
Click a button, get a complete, monitored environment in ~10 minutes that
destroys itself when its time limit ends.

## Status
Work in progress. Phase 1 of 9: foundation and local Jenkins.

<!-- Sections added as we build: Architecture, Quick start, Demo flow,
Results, What broke and how I fixed it, Known limitations -->

## Sample application and monitoring
A three-tier sample app (nginx frontend, Node API, PostgreSQL) is deployed to each
environment with a Helm chart (`k8s/charts/sample-app`): health probes, resource limits,
an HPA on the API and default-deny NetworkPolicies. Prometheus and Grafana are installed
with a trimmed kube-prometheus-stack (`k8s/monitoring`), with two alerts (node down,
high CPU) and a per-environment dashboard generated from a template.

Deploy to an existing environment:
```bash
./scripts/fetch-kubeconfig.sh <env-id>
./scripts/deploy-k8s.sh <env-id>
```

## Pipeline
Two Jenkins pipelines drive everything. `eaas-create` validates input, checks capacity,
runs Terraform, configures nodes with Ansible, deploys the app (and monitoring for
medium environments), smoke tests it, and writes `status.json`. If any step fails after
provisioning has started, it destroys what it created and verifies nothing is left.
`eaas-destroy` removes an environment idempotently. See `docs/decisions/` (ADR-009 to ADR-011).

## Portal
A small web portal (`portal/`, Node.js/TypeScript API plus plain HTML/JS) creates, lists
and destroys environments through the Jenkins pipelines, shows live stage progress and
streams the Jenkins console. It keeps no database: AWS tags and the Jenkins API are the
source of truth. It binds to localhost and guards against DNS rebinding and CSRF.

```bash
cd portal
cp .env.example .env     # fill in Jenkins user/token and the read-only AWS profile
npm install
npm run dev              # http://localhost:3000
npm test
```

## TTL auto-destroy, cost and budget
Every environment carries an `expires-at` tag. A Lambda (EventBridge, every 5 minutes) finds expired
environments and queues a destroy request in SQS, which the portal turns into the Jenkins destroy job.
If an environment is still running 30 minutes past expiry, the Lambda terminates its instances directly,
so billing stops even when the laptop running Jenkins is off. The portal shows an estimated cost and can
extend a TTL (capped at 4 hours remaining). Alarms email on reaper failure, and a monthly budget alerts
at 80% actual and 100% forecast. See `docs/decisions/` (ADR-013, ADR-014) and
`docs/deployment/cost-management.md`.

## TTL auto-destroy, cost and budget
Every environment carries an `expires-at` tag. A Lambda (EventBridge, every 5 minutes) finds expired
environments and queues a destroy request in SQS, which the portal turns into the Jenkins destroy job.
If an environment is still running 30 minutes past expiry, the Lambda terminates its instances directly,
so billing stops even when the laptop running Jenkins is off. The portal shows an estimated cost and can
extend a TTL (capped at 4 hours remaining). Alarms email on reaper failure, and a monthly budget alerts
at 80% actual and 100% forecast. See `docs/decisions/` (ADR-013, ADR-014) and
`docs/deployment/cost-management.md`.

## TTL auto-destroy, cost and budget
Every environment carries an `expires-at` tag. A Lambda (EventBridge, every 5 minutes) finds expired
environments and queues a destroy request in SQS, which the portal turns into the Jenkins destroy job.
If an environment is still running 30 minutes past expiry, the Lambda terminates its instances directly,
so billing stops even when the laptop running Jenkins is off. The portal shows an estimated cost and can
extend a TTL (capped at 4 hours remaining). Alarms email on reaper failure, and a monthly budget alerts
at 80% actual and 100% forecast. See `docs/decisions/` (ADR-013, ADR-014) and
`docs/deployment/cost-management.md`.

## TTL auto-destroy, cost and budget
Every environment carries an `expires-at` tag. A Lambda (EventBridge, every 5 minutes) finds expired
environments and queues a destroy request in SQS, which the portal turns into the Jenkins destroy job.
If an environment is still running 30 minutes past expiry, the Lambda terminates its instances directly,
so billing stops even when the laptop running Jenkins is off. The portal shows an estimated cost and can
extend a TTL (capped at 4 hours remaining). Alarms email on reaper failure, and a monthly budget alerts
at 80% actual and 100% forecast. See `docs/decisions/` (ADR-013, ADR-014) and
`docs/deployment/cost-management.md`.
