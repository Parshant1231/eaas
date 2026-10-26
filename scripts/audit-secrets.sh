#!/usr/bin/env bash
# Repository secrets audit. Prints findings (never the secret values) and exits 1 if any are found.
set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
bad() { echo "FOUND: $*"; FAIL=1; }
PATTERNS='AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|aws_secret_access_key|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}|xox[baprs]-[A-Za-z0-9-]{10,}'

echo "== 1. Files that must never be tracked"
while IFS= read -r f; do
  case "$f" in *.example) continue ;; esac
  case "$(basename "$f")" in
    .env|*.pem|*.key|*.tfstate|*.tfstate.*|*.tfvars|*.tfvars.json|*.tfplan|backend.hcl|recovery.json|status.json|credentials|id_rsa|id_ed25519|kubeconfig|*.kubeconfig)
      bad "tracked file: $f" ;;
  esac
  case "$f" in
    .kube/*|*/.kube/*|.tfdata/*|*/.terraform/*) bad "tracked file: $f" ;;
  esac
done < <(git ls-files)

echo "== 2. Secret-like patterns in tracked files"
hits=$(git grep -InE "$PATTERNS" -- . ':(exclude)scripts/audit-secrets.sh' | cut -d: -f1,2 || true)
if [[ -n "$hits" ]]; then bad "secret-like pattern at (file:line):"; echo "$hits"; fi

echo "== 3. Secret-like patterns anywhere in Git history"
count=$(git log --all -p --no-color -- . ':(exclude)scripts/audit-secrets.sh' | grep -cE "$PATTERNS" || true)
if [[ "${count:-0}" -gt 0 ]]; then
  bad "history contains ${count} matching line(s). Locate them with: git log --all -p -G'<pattern>'"
fi

echo "== 4. .gitignore covers the sensitive paths"
for p in .env portal/.env jenkins/.env terraform/environment/dev.tfvars terraform/environment/backend.hcl \
         terraform/backend/terraform.tfstate terraform/environment/dev.tfplan recovery.json key.pem; do
  git check-ignore -q "$p" || bad ".gitignore does not cover $p"
done

if [[ $FAIL -eq 0 ]]; then echo "audit passed"; else echo "audit FAILED" >&2; fi
exit $FAIL
