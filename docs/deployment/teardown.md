# Teardown

Order matters. Start with the environments, end with the state bucket.

1. Destroy every environment from the portal (or run eaas-destroy), then confirm nothing is left:
   aws ec2 describe-vpcs --filters "Name=tag:project,Values=eaas" --query 'Vpcs[].VpcId' --output text
   aws ec2 describe-instances --filters "Name=tag:project,Values=eaas" "Name=instance-state-name,Values=pending,running,stopped" --query 'Reservations[].Instances[].InstanceId' --output text
2. Stop the portal and Jenkins (docker compose down, never with -v unless you want to delete Jenkins data).
3. Guardrails: terraform -chdir=terraform/guardrails destroy -var-file=terraform.tfvars
   (removes the Lambda, schedule, queue, alarms, budget and the portal's extra policy).
4. Delete the access keys first, then the identities:
   aws iam list-access-keys --user-name eaas-jenkins   (delete each key with aws iam delete-access-key)
   aws iam list-access-keys --user-name eaas-portal    (same)
   terraform -chdir=terraform/pipeline-iam destroy -var="state_bucket_name=<bucket>"
5. State bucket last. It has prevent_destroy and holds versioned state: remove that lifecycle block on purpose,
   empty the bucket including old versions, then destroy it.
6. If anything was deleted by hand, run the verification commands in step 1 and delete leftovers by ID in
   dependency order (instances, security groups, subnets, route tables, internet gateway, VPC).

## What if AWS resources are deleted by accident?
Environments are disposable: re-create them from the portal. If the state bucket is lost, recreate it with
terraform/backend and re-run init for each root; environment state is then gone, so verify leftovers by tag.
