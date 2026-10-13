#!/usr/bin/env bash
set -euo pipefail

ENV_ID="${1:?usage: deploy-k8s.sh <env-id>}"
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/k8s/versions.env"

export KUBECONFIG="$HOME/.kube/eaas-${ENV_ID}.yaml"
[[ -s "$KUBECONFIG" ]] || { echo "kubeconfig not found; run scripts/fetch-kubeconfig.sh ${ENV_ID}" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

NODES="$(kubectl get nodes -o name)"; [[ "$NODES" == *"node/${ENV_ID}-node-"* ]] || { echo "cluster does not look like ${ENV_ID}; refusing to deploy" >&2; exit 1; }
echo "==> cluster check"
kubectl get nodes

echo "==> namespaces"
kubectl create namespace app --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -

echo "==> secrets (created once, random, never in Git)"
kubectl -n app get secret postgres-credentials >/dev/null 2>&1 || \
  kubectl -n app create secret generic postgres-credentials \
    --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 16)"
kubectl -n monitoring get secret grafana-admin >/dev/null 2>&1 || \
  kubectl -n monitoring create secret generic grafana-admin \
    --from-literal=admin-user=admin --from-literal=admin-password="$(openssl rand -hex 12)"

echo "==> monitoring stack"
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update >/dev/null
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring --version "$KPS_CHART_VERSION" \
  -f "$ROOT/k8s/monitoring/values.yaml" --wait --timeout 10m

echo "==> alert rules and dashboard"
kubectl apply -f "$ROOT/k8s/monitoring/alert-rules.yaml"
sed "s/__ENV_ID__/${ENV_ID}/g" "$ROOT/k8s/monitoring/dashboards/env-overview.json.tpl" > "$TMP/env-overview.json"
kubectl -n monitoring create configmap eaas-dashboard \
  --from-file=env-overview.json="$TMP/env-overview.json" --dry-run=client -o yaml \
  | kubectl label --local -f - grafana_dashboard=1 -o yaml \
  | kubectl apply -f -

echo "==> sample app"
helm upgrade --install sample-app "$ROOT/k8s/charts/sample-app" \
  --namespace app --wait --timeout 5m

SERVER_URL="$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
IP="${SERVER_URL#https://}"; IP="${IP%:6443}"
echo
echo "App:     http://${IP}:30080"
echo "Grafana: http://${IP}:30300  (user: admin)"
echo "Grafana password: kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d"
