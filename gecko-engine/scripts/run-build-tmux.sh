#!/usr/bin/env bash
set -euo pipefail
ROOT="${SPECULUM_GECKO_ROOT:-$HOME/speculum-gecko}"
ENGINE="${SPECULUM_GECKO_ENGINE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export MOZCONFIG="${MOZCONFIG:-$ENGINE/mozconfig}"
export SCCACHE_DIR="${SCCACHE_DIR:-$ROOT/.ccache}"
mkdir -p "$SCCACHE_DIR"
JOBS="${JOBS:-$(nproc)}"
export SPECULUM_GECKO_ROOT="$ROOT"
export MOZ_MAKE_FLAGS="-j${JOBS}"
mkdir -p "$ROOT"

monitor_ram() {
  while sleep 120; do
    date --iso-8601=seconds
    free -m | awk '/^Mem:/{printf "RAM_used_MB=%d RAM_total_MB=%d\n",$3,$2}'
  done
}

{
  monitor_ram &
  MON=$!
  /usr/bin/time -f 'ELAPSED_SEC=%e MAX_RSS_KB=%M' -o "$ROOT/build.meta" \
    timeout 28800 bash "$ENGINE/scripts/build.sh" build
  RC=$?
  kill "$MON" 2>/dev/null || true
  echo "EXIT_CODE=$RC" >>"$ROOT/build.meta"
  du -sh "$ROOT/checkout/obj-"* 2>/dev/null | tee "$ROOT/build-size.txt" || du -sh "$ROOT/checkout" >>"$ROOT/build-size.txt"
  sccache -s >"$ROOT/sccache-post-build.txt" 2>&1 || true
} >"$ROOT/build-run.log" 2>&1
echo "BUILD_DONE rc=$RC" >>"$ROOT/progress.log"
