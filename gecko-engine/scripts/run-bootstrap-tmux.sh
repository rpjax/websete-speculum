#!/usr/bin/env bash
set -euo pipefail
ROOT="${SPECULUM_GECKO_ROOT:-$HOME/speculum-gecko}"
ENGINE="${SPECULUM_GECKO_ENGINE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
mkdir -p "$ROOT"
export SPECULUM_GECKO_ROOT="$ROOT"
{
  /usr/bin/time -f 'ELAPSED_SEC=%e' -o "$ROOT/bootstrap.meta" \
    timeout 3600 bash "$ENGINE/scripts/bootstrap.sh"
  echo "EXIT_CODE=$?" >>"$ROOT/bootstrap.meta"
} >"$ROOT/bootstrap.log" 2>&1
echo "BOOTSTRAP_DONE" >>"$ROOT/progress.log"
