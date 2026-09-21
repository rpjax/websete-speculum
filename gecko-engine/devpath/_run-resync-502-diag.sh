#!/bin/bash
# Diag RESYNC reasons + SW 502 join chain — Beleza cold.
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DISPLAY="${DISPLAY:-:0}"
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
sed -i 's/\r$//' gecko-engine/devpath/lab-resync-502-diag.mjs \
  gecko-engine/devpath/_restart-lab-safe.sh 2>/dev/null || true
rm -f /tmp/speculum-asset-trace.ndjson
export SPECULUM_ASSET_TRACE=1
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -5
STAMP=$(date -u +%Y%m%d-%H%M%SZ)
OUT_DIR="${OUT_DIR:-$REPO/gecko-engine/devpath/captures/resync-502-$STAMP}"
rm -rf "$OUT_DIR"
export OUT_DIR WAIT_MS="${WAIT_MS:-50000}" GECKO_ASSET_TRACE=/tmp/speculum-asset-trace.ndjson SPECULUM_ASSET_TRACE=1
set +e
node gecko-engine/devpath/lab-resync-502-diag.mjs \
  "${1:-https://www.belezanaweb.com.br/}" | tee /tmp/resync-502-out.json
rc=${PIPESTATUS[0]}
set -e
echo "OUT=$OUT_DIR rc=$rc"
python3 - <<'PY'
import json
d=json.load(open('/tmp/resync-502-out.json'))
print('=== RESYNC+502 DIAG ===')
print('hud', d.get('hud',{}).get('resync'), 'desync', d.get('hud',{}).get('desync'), 'gen', d.get('hud',{}).get('generation'))
print('resyncReasons', json.dumps(d.get('resync',{}).get('reasons'), indent=2))
print('502', d.get('assets502',{}).get('count'), 'why', d.get('assets502',{}).get('whyBuckets'))
print('nextFixes:')
for f in d.get('nextFixHints') or []:
  print(f"  - {f.get('id')}: {f.get('cause')} — {f.get('fixHint')}")
for r in (d.get('assets502',{}) or {}).get('rows') or [][:8]:
  print(f"  502 {r.get('swWhy')} magic={r.get('inputMagic')} join={r.get('joinPath')} emit={r.get('emitMime')}/{r.get('emitLen')} {r.get('url','')[:90]}")
PY
exit "$rc"
