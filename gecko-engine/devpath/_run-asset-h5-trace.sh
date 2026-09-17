#!/bin/bash
# Asset H5 absolute diag — Beleza cold → dossier + verdict V1–V10.
# Não declara Fixed.
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DISPLAY="${DISPLAY:-:0}"
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
sed -i 's/\r$//' gecko-engine/devpath/lab-asset-h5-trace.mjs \
  gecko-engine/devpath/_restart-lab-safe.sh 2>/dev/null || true

# Rebuild lab client only if requested (Windows npm is preferred; WSL esbuild often broken).
if [[ "${SKIP_LAB_CLIENT_BUILD:-0}" != "1" ]]; then
  cd "$REPO/sidecar"
  npm run build:lab-client 2>&1 | tail -8 || {
    echo "WARN: lab-client build failed in this shell — using existing static/client.js"
  }
  cd "$REPO"
fi

rm -f /tmp/speculum-asset-trace.ndjson
export SPECULUM_ASSET_TRACE=1
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -6

STAMP=$(date -u +%Y%m%d-%H%M%SZ)
OUT_DIR="${OUT_DIR:-$REPO/gecko-engine/devpath/captures/asset-h5-$STAMP}"
rm -rf "$OUT_DIR"
export OUT_DIR WAIT_MS="${WAIT_MS:-45000}" GECKO_ASSET_TRACE=/tmp/speculum-asset-trace.ndjson SPECULUM_ASSET_TRACE=1
set +e
node gecko-engine/devpath/lab-asset-h5-trace.mjs \
  "${1:-https://www.belezanaweb.com.br/}" | tee /tmp/asset-h5-out.json
rc=${PIPESTATUS[0]}
set -e
echo "OUT=$OUT_DIR rc=$rc"
# latest symlink-ish copy for WIP
LATEST="$REPO/gecko-engine/devpath/captures/asset-h5-latest"
rm -rf "$LATEST"
mkdir -p "$LATEST"
cp -a "$OUT_DIR"/. "$LATEST"/ 2>/dev/null || true
python3 - <<'PY'
import json, os
p=os.environ.get('OUT_DIR')
d=json.load(open('/tmp/asset-h5-out.json'))
print('=== H5 TRACE ===')
print('firstFalse', d.get('firstFalse'))
print('classification', d.get('classification'))
print('verdict', json.dumps(d.get('verdict'), indent=2))
print('broken', json.dumps(d.get('broken'), indent=2))
print('outDir', d.get('outDir') or p)
bpath=os.path.join(d.get('outDir') or p, 'broken-classify.json')
if os.path.isfile(bpath):
  b=json.load(open(bpath))
  print('buckets', json.dumps(b.get('buckets'), indent=2))
  for r in (b.get('rows') or [])[:12]:
    print(f"  {r.get('reason')}: {r.get('magic')} enc={r.get('contentEncoding')} mime={r.get('mime')} len={r.get('dataLen')} {r.get('url','')[:100]}")
PY
exit "$rc"
