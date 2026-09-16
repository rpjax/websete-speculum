#!/bin/bash
# AVIF decode fork — blob Image vs page <img> no Projected.
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DISPLAY="${DISPLAY:-:0}"
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
sed -i 's/\r$//' gecko-engine/devpath/lab-avif-decode-probe.mjs \
  gecko-engine/devpath/_restart-lab-safe.sh 2>/dev/null || true
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -4
STAMP=$(date -u +%Y%m%d-%H%M%SZ)
OUT_DIR="${OUT_DIR:-$REPO/gecko-engine/devpath/captures/avif-decode-$STAMP}"
rm -rf "$OUT_DIR"
export OUT_DIR WAIT_MS="${WAIT_MS:-45000}"
set +e
node gecko-engine/devpath/lab-avif-decode-probe.mjs \
  "${1:-https://www.belezanaweb.com.br/}" | tee /tmp/avif-decode-out.json
rc=${PIPESTATUS[0]}
set -e
echo "OUT=$OUT_DIR rc=$rc"
python3 - <<'PY'
import json
d=json.load(open('/tmp/avif-decode-out.json'))
print('=== AVIF DECODE FORK ===')
print('verdict', d.get('verdict'))
print('cause', d.get('cause'))
print('fixHint', d.get('fixHint'))
print('pageImg', d.get('pageImg'))
print('blobImage', d.get('blobImage'))
print('createBitmap', d.get('createBitmap'))
print('fetch', d.get('fetchInfo'))
print('pageDecode', d.get('pageDecode'))
PY
exit "$rc"
