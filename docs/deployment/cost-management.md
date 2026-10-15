# Cost management

## What costs money
- EC2 instances (t3.small about $0.0224/hr, t3.medium about $0.0448/hr in ap-south-1)
- Public IPv4 addresses (about $0.005/hr each)
- EBS root volumes
- S3 state bucket (cents)

## Controls
- Mandatory TTL on every environment (1, 2 or 4 hours), enforced by variable validation
- Instance types limited to t3.micro/small/medium in the compute module
- No NAT Gateway
- Environments always destroyed after tests; verified with describe commands
- Monthly budget alert on the account (console, one-time)
- State bucket protected with prevent_destroy

## Verify cleanup after a test
aws ec2 describe-instances --filters "Name=tag:env-id,Values=<env>"
aws ec2 describe-vpcs --filters "Name=tag:env-id,Values=<env>"

## Pipeline controls
- Maximum 3 environments, enforced under a lock before any resource is created
- Failed builds destroy what they created and verify it (scripts/verify-cleanup.sh)
- Dedicated IAM user limited to ap-south-1 and eaas-tagged deletes
- TTL is a tag today; automatic expiry arrives with the Phase 7 Lambda
