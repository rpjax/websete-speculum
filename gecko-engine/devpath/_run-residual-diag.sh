#!/bin/bash
# Residual Beleza diag — AVIF/other broken + CSSOM hash num cold só.
# Não declara Fixed.
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DISPLAY="${DISPLAY:-:0}"
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
sed -i 's/\r$//' gecko-engine/devpath/lab-residual-diag.mjs \
  gecko-engine/devpath/_restart-lab-safe.sh 2>/dev/null || true

rm -f /tmp/speculum-asset-trace.ndjson
export SPECULUM_ASSET_TRACE=1
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -6

STAMP=$(date -u +%Y%m%d-%H%M%SZ)
OUT_DIR="${OUT_DIR:-$REPO/gecko-engine/devpath/captures/residual-$STAMP}"
rm -rf "$OUT_DIR"
export OUT_DIR WAIT_MS="${WAIT_MS:-45000}" GECKO_ASSET_TRACE=/tmp/speculum-asset-trace.ndjson SPECULUM_ASSET_TRACE=1
set +e
node gecko-engine/devpath/lab-residual-diag.mjs \
  "${1:-https://www.belezanaweb.com.br/}" | tee /tmp/residual-out.json
rc=${PIPESTATUS[0]}
set -e
echo "OUT=$OUT_DIR rc=$rc"
LATEST="$REPO/gecko-engine/devpath/captures/residual-latest"
rm -rf "$LATEST"
mkdir -p "$LATEST"
cp -a "$OUT_DIR"/. "$LATEST"/ 2>/dev/null || true
python3 - <<'PY'
import json, os
p=os.environ.get('OUT_DIR')
d=json.load(open('/tmp/residual-out.json'))
print('=== RESIDUAL DIAG ===')
print('outDir', d.get('outDir') or p)
print('brokenImgs', d.get('brokenImgs'))
print('formatBuckets', json.dumps(d.get('formatBuckets'), indent=2))
print('reasonBuckets', json.dumps(d.get('reasonBuckets'), indent=2))
print('cssom', json.dumps(d.get('cssom'), indent=2))
print('bugs:')
for b in d.get('bugs') or []:
  print(f"  [{b.get('status')}] {b.get('id')}: {b.get('cause')} count={b.get('count')}")
print('nextFixes:')
for f in d.get('nextFixes') or []:
  print(f"  - {f.get('id')}: {f.get('fixHint')}")
rc_path=os.path.join(d.get('outDir') or p, 'root-cause.json')
if os.path.isfile(rc_path):
  print('root-cause written', rc_path)
PY
exit "$rc"
