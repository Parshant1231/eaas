#!/usr/bin/env bash
set -euo pipefail

CMD="${1:-}"
ENV_ID="${2:-}"
[[ "$CMD" =~ ^(plan|apply|destroy)$ ]] || { echo "usage: tf-env.sh <plan|apply|destroy> <env-id>" >&2; exit 1; }
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }
: "${EAAS_STATE_BUCKET:?EAAS_STATE_BUCKET is not set}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="$ROOT/terraform/environment"
export TF_DATA_DIR="$ROOT/.tfdata/$ENV_ID"
export TF_IN_AUTOMATION=1
export TF_VAR_env_id="$ENV_ID"

if [[ -n "${TF_PLUGIN_CACHE_DIR:-}" ]]; then
  mkdir -p "$TF_PLUGIN_CACHE_DIR"
fi
mkdir -p "$TF_DATA_DIR"

case "$CMD" in
  destroy)
    # Placeholders only: they do not change what destroy removes, they just satisfy variable validation
    export TF_VAR_owner="${TF_VAR_owner:-cleanup}"
    export TF_VAR_size="${TF_VAR_size:-small}"
    export TF_VAR_ttl_hours="${TF_VAR_ttl_hours:-1}"
    export TF_VAR_expires_at="${TF_VAR_expires_at:-1970-01-01T00:00:00Z}"
    export TF_VAR_operator_cidr="${TF_VAR_operator_cidr:-203.0.113.1/32}"
    export TF_VAR_public_key="${TF_VAR_public_key:-placeholder}"
    ;;
  plan)
    for v in TF_VAR_owner TF_VAR_size TF_VAR_ttl_hours TF_VAR_expires_at TF_VAR_operator_cidr TF_VAR_public_key; do
      [[ -n "${!v:-}" ]] || { echo "$v is required for plan" >&2; exit 1; }
    done
    ;;
esac

tf() { terraform -chdir="$TF_DIR" "$@"; }

tf init -input=false -reconfigure \
  -backend-config="bucket=$EAAS_STATE_BUCKET" \
  -backend-config="region=${AWS_DEFAULT_REGION:-ap-south-1}" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true" \
  -backend-config="key=envs/${ENV_ID}/terraform.tfstate"

PLAN="$TF_DATA_DIR/plan.tfplan"
case "$CMD" in
  plan)    tf plan -input=false -lock-timeout=120s -out="$PLAN" ;;
  apply)   tf apply -input=false -lock-timeout=120s "$PLAN" ;;
  destroy) tf destroy -input=false -auto-approve -lock-timeout=120s ;;
esac
