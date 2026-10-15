# ADR-010: Dedicated least-privilege IAM user, secrets in Jenkins credentials

## Status
Accepted

## Context
The pipeline needs AWS access and an SSH key. Jenkins runs locally, so it cannot use an
instance role.

## Decision
Terraform creates an IAM user (eaas-jenkins) with a scoped policy: explicit EC2 action
list, region lock, tag-scoped termination and deletes, S3 access limited to envs/*, and
one SSM parameter. The access key is created manually with the CLI (never in Terraform
state) and stored only in Jenkins credentials. The SSH key is dedicated and stored the
same way. Runtime passwords are generated per environment into Kubernetes Secrets.

## Alternatives considered
- Mount ~/.aws into the container: exposes admin credentials to every job.
- Store keys in Secrets Manager or SSM: still needs bootstrap credentials for Jenkins.

## Reason
Smallest blast radius with the fewest moving parts.

## Consequences
- A long-lived access key exists and must be rotated and deleted when the project ends.
- Entering credentials in the Jenkins UI is manual (JCasC would make it declarative).
- Not every action is tag-scoped, because RunInstances touches untagged resources.
