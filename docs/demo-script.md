# Two-minute demo script

## Before the interview (20 minutes ahead)
- Start Jenkins and the portal; create a medium environment with a 4-hour TTL and wait until it is ready.
- Open the app, Grafana (log in), the Jenkins stage view of a previous create and the portal in separate tabs.
- Have the results table (`./scripts/summarize-injections.sh`) and a screenshot of a node-kill run ready as a fallback.

## Script
**0:00 to 0:15, the problem.** "Developers wait days for an environment, nobody tracks cost, and forgotten
environments keep billing. I built a self-service platform that gives a monitored environment in minutes and
destroys it automatically."

**0:15 to 0:45, the portal.** Show the ready environment: state, owner, time remaining, estimated cost, App and
Grafana links. "Everything here is derived from AWS tags and Jenkins, so the portal has no database."

**0:45 to 1:15, how it is built.** Show the Jenkins stage view: validate, security scan, capacity check, Terraform,
Ansible, Helm, smoke test. "Checkov and Trivy run before anything is created. If any step fails after provisioning
starts, the pipeline destroys what it made and verifies nothing is left."

**1:15 to 1:45, break it.** Inject a pod kill live (it recovers in seconds), then show the stored node-kill result:
"the worker was powered off, pods moved to the other node, the NodeDown alert fired, and the portal recorded the
recovery time and how many user requests failed."

**1:45 to 2:00, the safety net and honesty.** "A Lambda finds expired environments by tag, and even if my laptop is
off it terminates their instances so billing stops. The weakest part is the single local Jenkins and the lack of
portal authentication; both are documented."

## If something breaks
Say what you see, show the log, and switch to the screenshots. The incident log is a story you can tell.
