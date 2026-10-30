#!/usr/bin/env bash
# Prints "true" when a push / pull request changes anything but documentation, "false" for a docs-only change (command #29: the Android run is skipped for those).
#
#   bash scripts/android/changed-code.sh <base sha> <head sha>
#
# A base that is missing, all zeros (a new branch) or not fetched counts as "code": the run is never skipped by mistake.
set -uo pipefail

base="${1:-}"
head="${2:-HEAD}"
if [ -z "$base" ] || [ "$base" = "0000000000000000000000000000000000000000" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo true
  exit 0
fi
files="$(git diff --name-only "$base" "$head" 2>/dev/null || true)"
if [ -z "$files" ]; then
  echo true
  exit 0
fi
# documentation: Markdown anywhere, and the licence
if printf '%s\n' "$files" | grep -Evq '(\.md$|^LICENSE$)'; then
  echo true
else
  echo false
fi
