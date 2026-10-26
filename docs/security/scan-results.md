# Security scan results

Tools: Checkov (Terraform) and Trivy (images, secrets, misconfigurations), pinned in jenkins/tool-versions.env.
Run by the eaas-create pipeline (Terraform and images, before anything is provisioned) and by the eaas-security job.

## Gates (a failure blocks creation)
- Checkov on terraform/environment and terraform/modules: no failed checks except documented skips
- Trivy on our two images: no fixable CRITICAL vulnerabilities
- Trivy secret scan and the repository audit

## Terraform findings

| Check | Decision | Reason |
|-------|----------|--------|
| CKV_AWS_135 EBS optimized | Fixed | ebs_optimized = true in the compute module |
| CKV2_AWS_12 default security group | Fixed | aws_default_security_group with no rules in the network module |
| CKV_AWS_126 detailed monitoring | Accepted | Costs money; node_exporter and Prometheus already provide metrics |
| CKV_AWS_88 and CKV_AWS_130 public IP | Accepted | Operator machine reaches nodes directly (ADR-004); access limited to one /32 |
| CKV_AWS_382 open egress | Accepted | Package installs and image pulls; no NAT gateway on purpose |
| CKV2_AWS_11 flow logs | Accepted | Cost for environments that live at most four hours |
| CKV2_AWS_41 instance role | Accepted | Nodes need no AWS API access |
| {{FILL: any other check your first run reported}} | {{FILL}} | {{FILL}} |

Only list a row as Fixed or Accepted if your run actually reported it. Delete rows that never appeared.

## Image findings (Trivy)
- Our images, fixable CRITICAL: {{FILL: result of the images gate}}
- Our images, fixable HIGH (informational): {{FILL: counts and what you did}}
- postgres:16-alpine (third-party, informational): {{FILL}}

## Misconfiguration scans (informational)
- Known: the PostgreSQL container starts as root (the official image needs it to initialise its data directory). Recorded as a limitation.
- {{FILL: anything else the Helm or Dockerfile scans reported, and what you did}}

## Bootstrap Terraform roots (informational)
{{FILL: summary of what the report mode printed for backend, pipeline-iam and guardrails, and which items you will not fix and why}}
