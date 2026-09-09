#!/usr/bin/env bash
set -uo pipefail

ROOT="${SPECULUM_WEBKIT_ROOT:-$HOME/speculum-webkit}"
CHECKOUT="$ROOT/checkout"
OUT="$ROOT/baseline"
mkdir -p "$OUT"
cd "$CHECKOUT"

export SPECULUM_WEBKIT_ROOT="$ROOT"
export CCACHE_DIR="${CCACHE_DIR:-$ROOT/.ccache}"

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
  return 0
}

: >"$OUT/progress.log"

run_suite bindings-tests 2700 perl Tools/Scripts/run-bindings-tests
run_suite javascriptcore-tests 2700 perl Tools/Scripts/run-javascriptcore-tests --no-build --root=WebKitBuild/WPE/Release
run_suite api-tests 2700 perl Tools/Scripts/run-api-tests --wpe --release
run_suite layout-tests 14400 perl Tools/Scripts/run-webkit-tests --wpe --release

echo "ALL_DONE" >>"$OUT/progress.log"
