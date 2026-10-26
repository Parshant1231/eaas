#!/usr/bin/env bash
# Offline checks of the whole repository. Run it from a fresh clone to prove the repo is self-contained.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { echo; echo "==> $*"; }

step "No empty files"
EMPTY=$(find . -type f -empty -not -path './.git/*' -not -path '*/node_modules/*' -not -path '*/.terraform/*' -not -path './security-report/*')
if [[ -n "$EMPTY" ]]; then echo "$EMPTY"; echo "empty files found" >&2; exit 1; fi

step "Shell scripts parse"
for f in scripts/*.sh; do bash -n "$f"; done

step "Dashboard JSON and Helm chart"
python3 -m json.tool k8s/monitoring/dashboards/env-overview.json.tpl > /dev/null
helm lint k8s/charts/sample-app

step "Terraform format and validate (no backend, no AWS calls)"
terraform fmt -check -recursive terraform
for dir in terraform/backend terraform/environment terraform/pipeline-iam terraform/guardrails; do
  terraform -chdir="$dir" init -backend=false -input=false > /dev/null
  terraform -chdir="$dir" validate
done

step "Lambda unit tests"
(cd lambda/ttl-reaper && python3 -m unittest -q)

step "Portal typecheck and tests"
(cd portal && npm ci --no-audit --no-fund > /dev/null && npm run typecheck)
if ! (cd portal && npm test > /tmp/portal-test.log 2>&1); then tail -30 /tmp/portal-test.log; exit 1; fi
tail -8 /tmp/portal-test.log

step "Secrets audit"
./scripts/audit-secrets.sh

echo; echo "ALL CHECKS PASSED"
