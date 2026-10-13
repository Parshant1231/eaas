#!/usr/bin/env bash
set -euo pipefail

ENV_ID="${1:?usage: fetch-kubeconfig.sh <env-id>}"
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }

KEY="${EAAS_SSH_KEY:-$HOME/.ssh/eaas-key}"
OUT="$HOME/.kube/eaas-${ENV_ID}.yaml"

IP=$(aws ec2 describe-instances \
  --filters "Name=tag:project,Values=eaas" "Name=tag:env-id,Values=${ENV_ID}" \
            "Name=tag:role,Values=server" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
[[ -n "$IP" && "$IP" != "None" ]] || { echo "no running server found for ${ENV_ID}" >&2; exit 1; }

mkdir -p "$HOME/.kube"
umask 077
TMP="$(mktemp "$HOME/.kube/.eaas-${ENV_ID}.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

ssh -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR -o ConnectTimeout=10 \
  "ubuntu@${IP}" 'sudo cat /etc/rancher/k3s/k3s.yaml' > "$TMP"

grep -q '^apiVersion:' "$TMP" || { echo "fetched file is not a kubeconfig (is k3s installed yet?)" >&2; exit 1; }
sed -i "s#https://127.0.0.1:6443#https://${IP}:6443#" "$TMP"
mv "$TMP" "$OUT"
chmod 600 "$OUT"
echo "$OUT"
