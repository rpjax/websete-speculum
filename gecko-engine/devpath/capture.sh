#!/usr/bin/env bash
# Speculum devpath — captura frames pelo WebSocket do supervisor (caminho real).
#
#   ./capture.sh [url] [rotulo]
#
# Sobe o supervisor (dono do browser), conecta em ws://127.0.0.1:4100/session
# como consumidor, grava frames + manifest no repo.
#
# Variaveis: GECKO=<checkout>  (default ~/speculum-gecko/checkout)
set -euo pipefail

URL="${1:-https://example.com}"
LABEL="${2:-captura}"
GECKO="${GECKO:-$HOME/speculum-gecko/checkout}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && git rev-parse --show-toplevel)"
HERE="$REPO/gecko-engine/devpath"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$REPO/gecko-engine/devpath/captures/$STAMP-$LABEL"
SUP="$REPO/gecko-engine/supervisor/src/Speculum.Supervisor"
PORT="${SPECULUM_SUPERVISOR_PORT:-4100}"
WS="${SPECULUM_SUPERVISOR_WS:-ws://127.0.0.1:$PORT/session}"
TIMEOUT="${TIMEOUT:-30}"

if [ ! -d "$GECKO" ]; then
  echo "checkout do Gecko nao encontrado em $GECKO (defina GECKO=...)" >&2
  exit 1
fi

DOTNET="$(command -v dotnet || true)"
for candidate in "$HOME/.dotnet/dotnet" /usr/share/dotnet/dotnet /usr/lib/dotnet/dotnet; do
  [ -n "$DOTNET" ] && break
  [ -x "$candidate" ] && DOTNET="$candidate"
done
if [ -z "$DOTNET" ]; then
  echo "dotnet nao encontrado" >&2
  exit 1
fi
export PATH="$(dirname "$DOTNET"):$PATH"

OBJ="$(cd "$GECKO" && ./mach environment --format=json \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["topobjdir"])')"
BIN="$OBJ/dist/bin/firefox"
if [ ! -x "$BIN" ]; then
  echo "binario do Gecko nao encontrado em $BIN (rode ./mach build binaries)" >&2
  exit 1
fi

mkdir -p "$OUT/logs"

echo "capturando $URL -> $OUT"
export SPECULUM_BROWSER_BIN="$BIN"
export SPECULUM_BROWSER_URL="$URL"
export SPECULUM_SUPERVISOR_PORT="$PORT"

"$DOTNET" run --project "$SUP" > "$OUT/logs/supervisor.log" 2>&1 &
SUP_PID=$!

cleanup() {
  kill "$SUP_PID" 2>/dev/null || true
  wait "$SUP_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Consumidor junto com o supervisor — esperar o health e depois o npx perde o seed.
npx --yes tsx "$HERE/capture.ts" "$OUT" "$WS" "$TIMEOUT"

{
  echo "url=$URL"
  echo "label=$LABEL"
  echo "stamp=$STAMP"
  echo "gecko=$GECKO"
  echo "supervisor_ws=$WS"
  echo "gecko_commit=$(cd "$GECKO" && git rev-parse HEAD 2>/dev/null || echo '?')"
  echo "speculum_commit=$(cd "$REPO" && git rev-parse HEAD)"
  echo "binary_mtime=$(stat -c %y "$BIN" 2>/dev/null || echo '?')"
} > "$OUT/MANIFEST.txt"

echo "--- frames ---"; ls -l "$OUT"/f-*.bin 2>/dev/null || echo "(nenhum)"
echo "--- logs ---"; ls -l "$OUT/logs" || true
echo
echo "capturado em: $OUT"
echo "agora rode:   ./verify.sh $OUT"
