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

## TTL enforcement and alerts
- Every environment has an expires-at tag. A Lambda checks every 5 minutes and requests destruction
  of expired environments; after a 30-minute grace it terminates the instances itself.
- Alarms (email) fire if the reaper errors or has not run for 15 minutes.
- A monthly budget alerts at 80% of actual and 100% of forecast spend (account-wide).
- The portal shows an estimated cost so far and a projection to expiry. It is an estimate, not a bill.
- Extend TTL is capped so the remaining time never exceeds 4 hours.

## Verify after any session
aws ec2 describe-vpcs --filters "Name=tag:project,Values=eaas" --query 'Vpcs[].VpcId' --output text
aws ec2 describe-instances --filters "Name=tag:project,Values=eaas" "Name=instance-state-name,Values=pending,running" --query 'Reservations[].Instances[].InstanceId' --output text

## TTL enforcement and alerts
- Every environment has an expires-at tag. A Lambda checks every 5 minutes and requests destruction
  of expired environments; after a 30-minute grace it terminates the instances itself.
- Alarms (email) fire if the reaper errors or has not run for 15 minutes.
- A monthly budget alerts at 80% of actual and 100% of forecast spend (account-wide).
- The portal shows an estimated cost so far and a projection to expiry. It is an estimate, not a bill.
- Extend TTL is capped so the remaining time never exceeds 4 hours.

## Verify after any session
aws ec2 describe-vpcs --filters "Name=tag:project,Values=eaas" --query 'Vpcs[].VpcId' --output text
aws ec2 describe-instances --filters "Name=tag:project,Values=eaas" "Name=instance-state-name,Values=pending,running" --query 'Reservations[].Instances[].InstanceId' --output text

## TTL enforcement and alerts
- Every environment has an expires-at tag. A Lambda checks every 5 minutes and requests destruction
  of expired environments; after a 30-minute grace it terminates the instances itself.
- Alarms (email) fire if the reaper errors or has not run for 15 minutes.
- A monthly budget alerts at 80% of actual and 100% of forecast spend (account-wide).
- The portal shows an estimated cost so far and a projection to expiry. It is an estimate, not a bill.
- Extend TTL is capped so the remaining time never exceeds 4 hours.

## Verify after any session
aws ec2 describe-vpcs --filters "Name=tag:project,Values=eaas" --query 'Vpcs[].VpcId' --output text
aws ec2 describe-instances --filters "Name=tag:project,Values=eaas" "Name=instance-state-name,Values=pending,running" --query 'Reservations[].Instances[].InstanceId' --output text

## TTL enforcement and alerts
- Every environment has an expires-at tag. A Lambda checks every 5 minutes and requests destruction
  of expired environments; after a 30-minute grace it terminates the instances itself.
- Alarms (email) fire if the reaper errors or has not run for 15 minutes.
- A monthly budget alerts at 80% of actual and 100% of forecast spend (account-wide).
- The portal shows an estimated cost so far and a projection to expiry. It is an estimate, not a bill.
- Extend TTL is capped so the remaining time never exceeds 4 hours.

## Verify after any session
aws ec2 describe-vpcs --filters "Name=tag:project,Values=eaas" --query 'Vpcs[].VpcId' --output text
aws ec2 describe-instances --filters "Name=tag:project,Values=eaas" "Name=instance-state-name,Values=pending,running" --query 'Reservations[].Instances[].InstanceId' --output text

## Failure injection costs
- A medium environment costs about $0.10 per hour; a full set of runs (5 types x 3) takes about 2 hours.
- A powered-off worker stops compute billing but keeps its disk; the test restarts it afterwards.
- Always destroy the test environment and run the verification commands above when finished.
