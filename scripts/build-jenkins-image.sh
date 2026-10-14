#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TERRAFORM_VERSION="$(terraform version -json | python3 -c 'import sys,json; print(json.load(sys.stdin)["terraform_version"])')"
AWSCLI_VERSION="$(aws --version 2>&1 | sed -E 's#aws-cli/([0-9.]+).*#\1#')"
HELM_VERSION="$(helm version --template '{{.Version}}')"
HELM_VERSION="${HELM_VERSION%%+*}"
K3S_VERSION="$(sed -nE 's/^k3s_version: "(.*)"$/\1/p' ansible/playbooks/group_vars/all.yml)"
KUBECTL_VERSION="${K3S_VERSION%%+*}"
STATE_BUCKET="$(terraform -chdir=terraform/backend output -raw state_bucket_name)"

[[ "$TERRAFORM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "bad terraform version: $TERRAFORM_VERSION" >&2; exit 1; }
[[ "$AWSCLI_VERSION" =~ ^2\.[0-9]+\.[0-9]+$ ]]        || { echo "bad aws cli version: $AWSCLI_VERSION" >&2; exit 1; }
[[ "$HELM_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]    || { echo "bad helm version: $HELM_VERSION" >&2; exit 1; }
[[ "$KUBECTL_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "bad kubectl version: $KUBECTL_VERSION" >&2; exit 1; }
[[ -n "$STATE_BUCKET" ]]                              || { echo "state bucket not found" >&2; exit 1; }

umask 077
cat > jenkins/.env <<ENVEOF
TERRAFORM_VERSION=$TERRAFORM_VERSION
AWSCLI_VERSION=$AWSCLI_VERSION
KUBECTL_VERSION=$KUBECTL_VERSION
HELM_VERSION=$HELM_VERSION
EAAS_STATE_BUCKET=$STATE_BUCKET
ENVEOF

echo "terraform=$TERRAFORM_VERSION awscli=$AWSCLI_VERSION kubectl=$KUBECTL_VERSION helm=$HELM_VERSION"
docker compose -f jenkins/docker-compose.yml build
docker compose -f jenkins/docker-compose.yml up -d
echo "Jenkins is restarting on http://localhost:8080"
