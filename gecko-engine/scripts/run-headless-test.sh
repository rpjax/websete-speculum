#!/usr/bin/env bash
set -euo pipefail
ROOT="${SPECULUM_GECKO_ROOT:-$HOME/speculum-gecko}"
CHECKOUT="$ROOT/checkout"
URL="${1:-https://example.com/}"
LOG="$ROOT/headless-test.log"
export SPECULUM_GECKO_ROOT="$ROOT"
: >"$LOG"

cd "$CHECKOUT"
{
  echo "=== mach run --headless $URL ==="
  timeout 60 ./mach run --headless "$URL"
} >"$LOG" 2>&1 &
PID=$!
sleep 15
if kill -0 "$PID" 2>/dev/null; then
  echo "ALIVE_15S=yes" >>"$LOG"
  wait "$PID" || echo "EXIT=$?" >>"$LOG"
else
  echo "ALIVE_15S=no" >>"$LOG"
  wait "$PID" || true
fi
