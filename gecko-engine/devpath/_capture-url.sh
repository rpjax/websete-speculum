#!/bin/bash
# Captura frames reais: ./gecko-engine/devpath/_capture-url.sh <url> [label] [timeout_s]
set -euo pipefail
URL="${1:?url}"
LABEL="${2:-site}"
TIMEOUT="${3:-60}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
GECKO="${GECKO:-$HOME/speculum-gecko/checkout}"
OBJ="$(cd "$GECKO" && ./mach environment --format=json \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["topobjdir"])')"
BIN="$OBJ/dist/bin/firefox"
PORT="${SPECULUM_SUPERVISOR_PORT:-4197}"
OUT="$REPO/gecko-engine/devpath/captures/$(date +%Y%m%d-%H%M%S)-$LABEL"
mkdir -p "$OUT/logs"
export SPECULUM_BROWSER_BIN="$BIN"
export SPECULUM_BROWSER_URL="$URL"
export SPECULUM_SUPERVISOR_PORT="$PORT"
echo "capturando $URL -> $OUT (port $PORT, ${TIMEOUT}s)"
/root/.dotnet/dotnet run --project "$REPO/gecko-engine/supervisor/src/Speculum.Supervisor" \
  > "$OUT/logs/supervisor.log" 2>&1 &
SUP=$!
cleanup() { kill "$SUP" 2>/dev/null || true; wait "$SUP" 2>/dev/null || true; }
trap cleanup EXIT
sleep 5
cd "$REPO/gecko-engine/devpath"
npx --yes tsx capture.ts "$OUT" "ws://127.0.0.1:$PORT/session" "$TIMEOUT"
{
  echo "url=$URL"
  echo "label=$LABEL"
  echo "timeout=$TIMEOUT"
  echo "port=$PORT"
} >> "$OUT/MANIFEST.txt"
ls -l "$OUT"/f-*.bin 2>/dev/null | wc -l
echo "OUT=$OUT"
