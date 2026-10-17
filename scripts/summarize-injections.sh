#!/usr/bin/env bash
# Prints a markdown table of MEASURED injection results (min / median / max per failure type).
# Needs the portal running, because it reads the portal's /api/injections.
set -euo pipefail

PORT="${PORTAL_PORT:-3000}"
curl -fsS "http://127.0.0.1:${PORT}/api/injections" | jq -r '
  def stat(f): (map(f) | map(select(. != null)) | sort) as $v
    | if ($v | length) == 0 then "–" else "\($v[0]) / \($v[(($v | length) / 2 | floor)]) / \($v[-1])" end;
  [.injections[] | select(.recovery != null) | .recovery] | group_by(.failure) |
  ("| Failure | Runs | Recovered | Detected s (min / median / max) | Recovered s (min / median / max) | Failed requests (min / median / max) |",
   "|---|---|---|---|---|---|",
   (.[] | "| \(.[0].failure) | \(length) | \(map(select(.recovered)) | length) | \(stat(.detectedSeconds)) | \(stat(.recoveredSeconds)) | \(stat(.failedRequests)) |"))'
