#!/usr/bin/env bash
# TEST HELPER: moves an environment's expires-at tag into the past so the TTL reaper can be
# exercised without waiting an hour. Uses your admin credentials. Never used by the pipeline.
set -euo pipefail

ENV_ID="${1:?usage: expire-env.sh <env-id> [minutes-ago]}"
MINUTES="${2:-10}"
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }
[[ "$MINUTES" =~ ^[0-9]{1,4}$ ]] || { echo "minutes must be a number" >&2; exit 1; }

PAST="$(date -u -d "-${MINUTES} min" +%Y-%m-%dT%H:%M:%SZ)"
VPC="$(aws ec2 describe-vpcs --filters "Name=tag:env-id,Values=${ENV_ID}" "Name=tag:project,Values=eaas" \
  --query 'Vpcs[0].VpcId' --output text)"
[[ -n "$VPC" && "$VPC" != "None" ]] || { echo "no eaas environment named ${ENV_ID}" >&2; exit 1; }
INSTANCES="$(aws ec2 describe-instances \
  --filters "Name=tag:env-id,Values=${ENV_ID}" "Name=tag:project,Values=eaas" "Name=instance-state-name,Values=pending,running" \
  --query 'Reservations[].Instances[].InstanceId' --output text)"

# shellcheck disable=SC2086
aws ec2 create-tags --resources $VPC $INSTANCES --tags "Key=expires-at,Value=${PAST}"
echo "expires-at set to ${PAST} on: ${VPC} ${INSTANCES}"
