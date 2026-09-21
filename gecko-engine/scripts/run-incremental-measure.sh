#!/usr/bin/env bash
# Mede iteracao incremental (comentario em .cpp, mach build binaries, 2 runs).
set -euo pipefail
ROOT="${SPECULUM_GECKO_ROOT:-$HOME/speculum-gecko}"
ENGINE="${SPECULUM_GECKO_ENGINE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CHECKOUT="$ROOT/checkout"
TARGET="${1:-dom/base/nsContentUtils.cpp}"
export SPECULUM_GECKO_ROOT="$ROOT"
export MOZCONFIG="${MOZCONFIG:-$ENGINE/mozconfig}"
LOG="$ROOT/incremental-measure.log"
: >"$LOG"

cd "$CHECKOUT"
FILE="$CHECKOUT/$TARGET"
[ -f "$FILE" ] || { echo "ABORT: $FILE nao existe" | tee -a "$LOG"; exit 1; }

echo "=== target: $FILE ===" | tee -a "$LOG"
cp "$FILE" "$FILE.bak"

for run in 1 2; do
  echo "=== incremental run $run ===" | tee -a "$LOG"
  echo "// speculum-incremental-measure run $run $(date --iso-8601=seconds)" >>"$FILE"
  set +e
  /usr/bin/time -f "RUN${run}_ELAPSED_SEC=%e" -o "$ROOT/incremental-run${run}.meta" \
    bash "$ENGINE/scripts/build.sh" binaries >>"$LOG" 2>&1
  RC=$?
  set -e
  cat "$ROOT/incremental-run${run}.meta" >>"$LOG"
  echo "RUN${run}_EXIT_CODE=$RC" >>"$LOG"
  git checkout -- "$FILE"
done

rm -f "$FILE.bak"
echo "=== reverted OK ===" | tee -a "$LOG"
echo "DONE" >>"$LOG"
