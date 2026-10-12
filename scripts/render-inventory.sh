#!/usr/bin/env bash
set -euo pipefail

ENV_ID="${1:?usage: render-inventory.sh <env-id>}"
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../ansible/inventory/generated/${ENV_ID}.aws_ec2.yml"
mkdir -p "$(dirname "$OUT")"
sed "s/__ENV_ID__/${ENV_ID}/" "$HERE/../ansible/inventory/aws_ec2.yml.tpl" > "$OUT"
echo "$OUT"
