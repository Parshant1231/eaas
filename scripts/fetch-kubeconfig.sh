#!/usr/bin/env bash
set -euo pipefail

ENV_ID="${1:?usage: fetch-kubeconfig.sh <env-id>}"
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
KEY="${EAAS_SSH_KEY:-$HOME/.ssh/eaas-key}"
OUT="${KUBECONFIG_OUT:-$HOME/.kube/eaas-${ENV_ID}.yaml}"
IP="$("$HERE/server-ip.sh" "$ENV_ID")"

mkdir -p "$(dirname "$OUT")"
umask 077
ssh -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
  "ubuntu@${IP}" 'sudo cat /etc/rancher/k3s/k3s.yaml' \
  | sed "s#https://127.0.0.1:6443#https://${IP}:6443#" > "$OUT"
chmod 600 "$OUT"
echo "$OUT"
