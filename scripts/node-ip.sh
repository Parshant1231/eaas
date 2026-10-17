#!/usr/bin/env bash
set -euo pipefail

ENV_ID="${1:?usage: node-ip.sh <env-id> <server|agent>}"
ROLE="${2:?usage: node-ip.sh <env-id> <server|agent>}"
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }
[[ "$ROLE" =~ ^(server|agent)$ ]] || { echo "invalid role" >&2; exit 1; }

IP=$(aws ec2 describe-instances \
  --filters "Name=tag:project,Values=eaas" "Name=tag:env-id,Values=${ENV_ID}" \
            "Name=tag:role,Values=${ROLE}" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
[[ -n "$IP" && "$IP" != "None" ]] || { echo "no running ${ROLE} found for ${ENV_ID}" >&2; exit 1; }
echo "$IP"
