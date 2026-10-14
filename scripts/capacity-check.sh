#!/usr/bin/env bash
set -euo pipefail

ENV_ID="${1:?usage: capacity-check.sh <env-id> [max]}"
MAX="${2:-3}"
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }

# Every environment owns exactly one VPC tagged env-id, so VPCs are the source of truth
IDS=$(aws ec2 describe-vpcs --filters "Name=tag:project,Values=eaas" \
        --query "Vpcs[].Tags[?Key=='env-id'].Value | []" --output text \
      | tr '\t' '\n' | sed '/^$/d' | sort -u)

if grep -qx "$ENV_ID" <<<"$IDS"; then
  echo "ERROR: environment '$ENV_ID' already exists (or an earlier build left resources behind)" >&2
  exit 1
fi

COUNT=$(sed '/^$/d' <<<"$IDS" | wc -l | tr -d ' ')
echo "existing environments: $COUNT (max $MAX)"
if (( COUNT >= MAX )); then
  echo "ERROR: capacity reached ($COUNT/$MAX). Destroy an environment first." >&2
  exit 1
fi
echo "capacity OK"
