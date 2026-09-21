#!/usr/bin/env bash
# Suítes baseline Gecko (sem GPU / SWGL). Ver docs/gecko-engine/04-baseline.md.
set -uo pipefail

ROOT="${SPECULUM_GECKO_ROOT:-$HOME/speculum-gecko}"
ENGINE="${SPECULUM_GECKO_ENGINE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CHECKOUT="$ROOT/checkout"
OUT="$ROOT/baseline"
PROFILE="${BASELINE_PROFILE:-$ENGINE/baseline-profile}"
mkdir -p "$OUT"
cd "$CHECKOUT"

export MOZCONFIG="${MOZCONFIG:-$ENGINE/mozconfig}"
export MOZ_HEADLESS=1
export MOZ_HEADLESS_WIDTH="${MOZ_HEADLESS_WIDTH:-1280}"
export MOZ_HEADLESS_HEIGHT="${MOZ_HEADLESS_HEIGHT:-720}"

# Reforço via --setpref (harness grava no profile de teste antes do browser subir).
PREFS=(
  --setpref "gfx.webrender.software=true"
  --setpref "gfx.webrender.enabled=true"
  --setpref "layers.acceleration.disabled=true"
  --setpref "layers.acceleration.force-enabled=false"
)

run_suite() {
  local name="$1"
  local teto="$2"
  shift 2
  local log="$OUT/${name}.log"
  local meta="$OUT/${name}.meta"
  echo "=== $name teto=${teto}s ===" | tee "$meta"
  set +e
  /usr/bin/time -f "ELAPSED_SEC=%e EXIT_CODE=%x" -o "$meta.tmp" \
    timeout "$teto" "$@" >"$log" 2>&1
  local rc=$?
  cat "$meta.tmp" >>"$meta"
  rm -f "$meta.tmp"
  echo "TIMEOUT_OR_EXIT=$rc" >>"$meta"
  echo "SUITE_DONE name=$name rc=$rc" >>"$OUT/progress.log"
}

: >"$OUT/progress.log"

run_suite xpcshell-test 2700 ./mach xpcshell-test "${PREFS[@]}"
run_suite mochitest 10800 ./mach mochitest --headless "${PREFS[@]}"
run_suite web-platform-tests 14400 ./mach web-platform-tests --headless "${PREFS[@]}"

echo "ALL_DONE" >>"$OUT/progress.log"
