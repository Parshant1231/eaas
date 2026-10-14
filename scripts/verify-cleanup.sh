#!/usr/bin/env bash
set -euo pipefail

ENV_ID="${1:?usage: verify-cleanup.sh <env-id>}"
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }

LEFT=0
report() {
  if [[ -n "$2" && "$2" != "None" ]]; then
    echo "LEFTOVER $1: $2"
    LEFT=1
  else
    echo "ok: no $1"
  fi
}

INSTANCES=$(aws ec2 describe-instances \
  --filters "Name=tag:env-id,Values=${ENV_ID}" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped,shutting-down" \
  --query 'Reservations[].Instances[].InstanceId' --output text)
VPCS=$(aws ec2 describe-vpcs --filters "Name=tag:env-id,Values=${ENV_ID}" \
  --query 'Vpcs[].VpcId' --output text)
KEYS=$(aws ec2 describe-key-pairs --filters "Name=tag:env-id,Values=${ENV_ID}" \
  --query 'KeyPairs[].KeyName' --output text)
VOLUMES=$(aws ec2 describe-volumes \
  --filters "Name=tag:env-id,Values=${ENV_ID}" "Name=status,Values=creating,available,in-use" \
  --query 'Volumes[].VolumeId' --output text)

report instances "$INSTANCES"
report vpcs "$VPCS"
report key-pairs "$KEYS"
report volumes "$VOLUMES"
exit "$LEFT"
