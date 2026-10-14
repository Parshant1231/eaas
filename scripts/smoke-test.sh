#!/usr/bin/env bash
set -euo pipefail

ENV_ID="${1:?usage: smoke-test.sh <env-id> <small|medium>}"
SIZE="${2:?usage: smoke-test.sh <env-id> <small|medium>}"
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }
[[ "$SIZE" =~ ^(small|medium)$ ]] || { echo "invalid size" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
IP="$("$HERE/server-ip.sh" "$ENV_ID")"
CURL=(curl -fsS --retry 12 --retry-delay 5 --retry-connrefused --retry-all-errors --max-time 10)

echo "==> frontend health"
"${CURL[@]}" "http://${IP}:30080/healthz"

echo "==> API through the frontend (database round trip)"
BODY=$("${CURL[@]}" "http://${IP}:30080/api/hits")
echo "$BODY"
grep -q '"hits"' <<<"$BODY" || { echo "unexpected API response" >&2; exit 1; }

if [[ "$SIZE" == "medium" ]]; then
  echo "==> Grafana health"
  GRAFANA=$("${CURL[@]}" "http://${IP}:30300/api/health")
  echo "$GRAFANA"
  grep -Eq '"database": *"ok"' <<<"$GRAFANA" || { echo "Grafana is not healthy" >&2; exit 1; }
fi
echo "smoke test passed"
