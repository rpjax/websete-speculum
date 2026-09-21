#!/bin/bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
GECKO="${GECKO:-$HOME/speculum-gecko/checkout}"
OBJ="$(cd "$GECKO" && ./mach environment --format=json \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["topobjdir"])')"
BIN="$OBJ/dist/bin/firefox"
OUT="$REPO/gecko-engine/devpath/captures/$(date +%Y%m%d-%H%M%S)-beleza-cold"
mkdir -p "$OUT/logs"
export SPECULUM_BROWSER_BIN="$BIN"
export SPECULUM_BROWSER_URL="https://www.belezanaweb.com.br/"
export SPECULUM_SUPERVISOR_PORT=4199
/root/.dotnet/dotnet run --project "$REPO/gecko-engine/supervisor/src/Speculum.Supervisor" \
  > "$OUT/logs/supervisor.log" 2>&1 &
SUP=$!
cleanup() { kill "$SUP" 2>/dev/null || true; wait "$SUP" 2>/dev/null || true; }
trap cleanup EXIT
sleep 4
cd "$REPO/gecko-engine/devpath"
npx --yes tsx capture.ts "$OUT" "ws://127.0.0.1:4199/session" 25
ls -l "$OUT"/f-*.bin 2>/dev/null || true
echo "OUT=$OUT"
