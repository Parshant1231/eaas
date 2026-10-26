#!/usr/bin/env bash
# Fails while the README or docs still contain unfilled placeholders, empty measurement cells or broken links.
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0

if grep -rn '{{FILL' README.md docs; then echo "^ unfilled {{FILL}} placeholders" >&2; FAIL=1; fi
if grep -rn '(paste here)' docs; then echo "^ unfilled '(paste here)' placeholders" >&2; FAIL=1; fi
if grep -nE '\|[[:space:]]*\|[[:space:]]*$' docs/testing/*.md; then echo "^ empty measurement cells" >&2; FAIL=1; fi

while IFS= read -r link; do
  path="${link%%#*}"
  if [[ -z "$path" || "$path" =~ ^https?:// ]]; then continue; fi
  if [[ ! -e "$path" ]]; then echo "broken link in README: $link" >&2; FAIL=1; fi
done < <(grep -oE '\]\([^)]+\)' README.md | sed -E 's/^\]\((.*)\)$/\1/')

if [[ $FAIL -eq 0 ]]; then echo "docs check passed"; fi
exit $FAIL
