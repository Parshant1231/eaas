#!/usr/bin/env bash
# Lists screenshots from docs/screenshots/MANIFEST.txt that are missing or empty.
set -uo pipefail
cd "$(dirname "$0")/.."
missing=0
while IFS= read -r f; do
  if [[ -z "$f" || "$f" == \#* ]]; then continue; fi
  if [[ ! -s "docs/screenshots/$f" ]]; then echo "missing: docs/screenshots/$f"; missing=$((missing + 1)); fi
done < docs/screenshots/MANIFEST.txt
echo "$missing screenshot(s) missing"
exit $(( missing > 0 ))
