#!/usr/bin/env bash
# Security scans used by the pipeline and by hand.
#   iac      Checkov on the Terraform used by every environment (GATE)
#   images   Trivy on our own images: fixable CRITICAL vulnerabilities (GATE)
#   secrets  Trivy secret scan plus the repository audit (GATE)
#   report   everything else, informational only (never fails)
set -euo pipefail

MODE="${1:?usage: security-scan.sh <iac|images|secrets|report>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/security-report"
mkdir -p "$OUT"
export TRIVY_CACHE_DIR="${TRIVY_CACHE_DIR:-$HOME/.cache/trivy}"

OWNER="${EAAS_IMAGE_OWNER:-parshant1231}"
TAG="${EAAS_IMAGE_TAG:-0.1.0}"
OWN_IMAGES=("ghcr.io/${OWNER}/eaas-api:${TAG}" "ghcr.io/${OWNER}/eaas-frontend:${TAG}")
THIRD_PARTY_IMAGES=("postgres:16-alpine")
CHECKOV=(checkov --config-file .checkov.yaml)

scan_iac() {
  echo "== Checkov: terraform/environment and terraform/modules (gate)"
  "${CHECKOV[@]}" -d terraform/environment -d terraform/modules
}

scan_images() {
  local img
  for img in "${OWN_IMAGES[@]}"; do
    echo "== Trivy: ${img} (gate: fixable CRITICAL)"
    trivy image --no-progress --scanners vuln --severity CRITICAL --ignore-unfixed --exit-code 1 "$img"
  done
}

scan_secrets() {
  echo "== Trivy: secret scan of the working tree (gate)"
  trivy fs --no-progress --scanners secret --exit-code 1 \
    --skip-dirs node_modules --skip-dirs .terraform --skip-dirs .tfdata --skip-dirs .kube --skip-dirs security-report .
  echo "== Repository audit: tracked files, patterns, history, .gitignore (gate)"
  ./scripts/audit-secrets.sh
}

scan_report() {
  local img
  echo "== Checkov: bootstrap roots (informational)"
  "${CHECKOV[@]}" -d terraform/backend -d terraform/pipeline-iam -d terraform/guardrails --soft-fail || true
  for img in "${OWN_IMAGES[@]}" "${THIRD_PARTY_IMAGES[@]}"; do
    echo "== Trivy: ${img} HIGH and CRITICAL, fixable (informational)"
    trivy image --no-progress --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed "$img" || true
  done
  echo "== Trivy: Helm chart misconfigurations (informational)"
  trivy config --no-progress --severity HIGH,CRITICAL k8s/charts || true
  echo "== Trivy: Dockerfile misconfigurations (informational)"
  trivy config --no-progress --severity HIGH,CRITICAL app || true
}

case "$MODE" in
  iac)     scan_iac     2>&1 | tee "$OUT/iac.txt" ;;
  images)  scan_images  2>&1 | tee "$OUT/images.txt" ;;
  secrets) scan_secrets 2>&1 | tee "$OUT/secrets.txt" ;;
  report)  scan_report  2>&1 | tee "$OUT/report.txt" ;;
  *) echo "unknown mode: $MODE" >&2; exit 1 ;;
esac
