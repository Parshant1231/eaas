#!/usr/bin/env bash
set -euo pipefail

ENV_ID="${1:?usage: server-ip.sh <env-id>}"
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }

IP=$(aws ec2 describe-instances \
  --filters "Name=tag:project,Values=eaas" "Name=tag:env-id,Values=${ENV_ID}" \
            "Name=tag:role,Values=server" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
[[ -n "$IP" && "$IP" != "None" ]] || { echo "no running server found for ${ENV_ID}" >&2; exit 1; }
echo "$IP"
