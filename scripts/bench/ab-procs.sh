#!/bin/bash
# Before / after benchmark of the 4-seat engine across many PROCESSES (CHATURAJI_SPEC.md sections 8.2 and 11).
#
#   scripts/bench/ab-procs.sh <baseline-checkout> [pairs=30] [out-dir=$TMPDIR/bench-ab]
#
# <baseline-checkout> is a git worktree of the commit BEFORE the change (with node_modules linked), e.g.
#   git worktree add ../bench-base <commit> && (link or install node_modules there)
# Each pair runs scripts/bench-fourplayer.ts once in the baseline tree and once in this tree, alternating which goes first, so slow stretches of the
# machine hit both sides. One process = one JIT history, and on a busy desktop that alone moves a workload by 10-20%, so the comparison is made
# across processes: `ab-stats.cjs` takes the median of the per-process best times of each side and a bootstrap 90% interval of their ratio.
#
# BENCH=<file> (default bench-fourplayer.ts) names another benchmark under scripts/ with the same --out JSON, e.g. BENCH=bench-crazyhouse.ts (Bughouse W0).
set -e
BASE="$1"; PAIRS="${2:-30}"; OUT="${3:-${TMPDIR:-/tmp}/bench-ab}"; BENCH="${BENCH:-bench-fourplayer.ts}"
[ -d "$BASE/scripts" ] || { echo "usage: $0 <baseline-checkout> [pairs] [out-dir]"; exit 2; }
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
TSX="$HERE/backend/node_modules/.bin/tsx"
mkdir -p "$OUT"; rm -f "$OUT"/abp-*.json
cp "$HERE/scripts/$BENCH" "$BASE/scripts/$BENCH"   # the same harness on both sides
for i in $(seq 1 "$PAIRS"); do
  if [ $((i % 2)) -eq 0 ]; then
    (cd "$BASE" && "$TSX" "scripts/$BENCH" --out "$OUT/abp-A-$i.json" > /dev/null 2>&1)
    (cd "$HERE" && "$TSX" "scripts/$BENCH" --out "$OUT/abp-B-$i.json" > /dev/null 2>&1)
  else
    (cd "$HERE" && "$TSX" "scripts/$BENCH" --out "$OUT/abp-B-$i.json" > /dev/null 2>&1)
    (cd "$BASE" && "$TSX" "scripts/$BENCH" --out "$OUT/abp-A-$i.json" > /dev/null 2>&1)
  fi
done
node "$HERE/scripts/bench/ab-stats.cjs" "$OUT"
