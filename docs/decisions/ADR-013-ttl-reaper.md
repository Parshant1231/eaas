# ADR-013: Level-triggered TTL reaper with a last-resort termination path

## Status
Accepted

## Context
Environments must destroy themselves at expiry, even if Jenkins (running on a laptop) is
unavailable, and half-built or orphaned environments must not bill forever.

## Decision
- An EventBridge rule runs a Python Lambda every 5 minutes.
- The Lambda reads expires-at tags from VPCs and instances (the latest valid value wins).
  For each expired environment it sends a destroy request to SQS. The portal polls the queue
  and triggers the Jenkins destroy job after re-checking the expiry in AWS.
- If an environment is still running 30 minutes past expiry, the Lambda terminates its instances
  directly (project=eaas instances only).
- Messages are hints. The Lambda recomputes every run and resends until the environment is gone.
- The Lambda starts in dry-run mode and is switched to live deliberately.
- Alarms on Lambda errors and on the reaper not running notify by email, and a monthly budget alerts at 80% actual and 100% forecast.

## Alternatives considered
- Lambda calls Jenkins directly: not possible, Jenkins is on a laptop.
- Lambda runs Terraform destroy: heavy packaging and a second place that owns state.
- Step Functions or DynamoDB to deduplicate requests: more services for a lab-sized problem.
- An edge-triggered design (send once): a lost message means a forgotten environment.

## Reason
Tags are the only source of truth that survives every failure, so the design is stateless.

## Consequences
- Duplicate messages are normal; the poller deduplicates and re-validates expiry.
- The last resort leaves free resources (VPC, subnet, key pair) until the destroy job runs.
- Anything tagged project=eaas that is past expiry plus grace will lose its instances.
- A dead reaper is only detected by the alarms (email), not prevented.
- The budget covers the whole account unless the project cost-allocation tag is activated.
