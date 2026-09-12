#!/usr/bin/env bash
# Speculum devpath — captura uma execucao real do Gecko: frames + logs, num
# diretorio carimbado DENTRO do repo. Captura nao vive em /tmp: se nao esta no
# repo, nao existe, e foi assim que a gente perdeu um bootstrap funcionando sem
# ninguem perceber.
#
#   ./capture.sh [url] [rotulo]
#
# Variaveis: GECKO=<checkout do gecko>  (default ~/speculum-gecko/checkout)
set -euo pipefail

URL="${1:-https://example.com}"
LABEL="${2:-captura}"
GECKO="${GECKO:-$HOME/speculum-gecko/checkout}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && git rev-parse --show-toplevel)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$REPO/gecko-engine/devpath/captures/$STAMP-$LABEL"

if [ ! -d "$GECKO" ]; then
  echo "checkout do Gecko nao encontrado em $GECKO (defina GECKO=...)" >&2
  exit 1
fi

mkdir -p "$OUT/logs"
FRAME_DIR_ABS="$(mkdir -p "$OUT" && cd "$OUT" && pwd)"

rm -rf /tmp/speculum-docs
mkdir -p /tmp/speculum-docs

OBJ="$(cd "$GECKO" && ./mach environment --format=json \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["topobjdir"])')"
BIN="$OBJ/dist/bin/firefox"
PROFILE="$(mktemp -d)"

echo "capturando $URL -> $OUT"
export SPECULUM_FRAME_DIR="$FRAME_DIR_ABS"
MOZ_CRASHREPORTER_DISABLE=1 timeout "${TIMEOUT:-30}" "$BIN" --headless \
  -profile "$PROFILE" -no-remote "$URL" > "$OUT/logs/stdout.log" 2>&1 || true

cp -a /tmp/speculum-docs/. "$OUT/logs/" 2>/dev/null || true

{
  echo "url=$URL"
  echo "label=$LABEL"
  echo "stamp=$STAMP"
  echo "gecko=$GECKO"
  echo "speculum_frame_dir=$FRAME_DIR_ABS"
  echo "gecko_commit=$(cd "$GECKO" && git rev-parse HEAD 2>/dev/null || echo '?')"
  echo "speculum_commit=$(cd "$REPO" && git rev-parse HEAD)"
  echo "binary_mtime=$(stat -c %y "$BIN" 2>/dev/null || echo '?')"
} > "$OUT/MANIFEST.txt"

echo "--- frames (IPC) ---"; ls -l "$OUT"/f-*.bin 2>/dev/null || echo "(nenhum)"
echo "--- logs ---";   ls -l "$OUT/logs"   || true
echo
echo "capturado em: $OUT"
echo "agora rode:   ./verify.sh $OUT"
