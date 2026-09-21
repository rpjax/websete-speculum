#!/bin/bash
# Beleza card click → DESYNC/RESYNC cascade diag (cold).
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DISPLAY="${DISPLAY:-:0}"
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
sed -i 's/\r$//' gecko-engine/devpath/lab-beleza-click-desync.mjs \
  gecko-engine/devpath/_restart-lab-safe.sh 2>/dev/null || true
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -8
STAMP=$(date -u +%Y%m%d-%H%M%SZ)
OUT_DIR="${OUT_DIR:-$REPO/gecko-engine/devpath/captures/click-desync-$STAMP}"
rm -rf "$OUT_DIR"
export OUT_DIR COLD_WAIT_MS="${COLD_WAIT_MS:-50000}" AFTER_CLICK_MS="${AFTER_CLICK_MS:-25000}"
set +e
node gecko-engine/devpath/lab-beleza-click-desync.mjs \
  "${1:-https://www.belezanaweb.com.br/}" | tee /tmp/click-desync-out.json
rc=${PIPESTATUS[0]}
set -e
echo "OUT=$OUT_DIR rc=$rc"
python3 - <<'PY'
import json
d=json.load(open('/tmp/click-desync-out.json'))
print('=== CLICK DESYNC DIAG ===')
print('click', d.get('click'))
print('hypothesis', d.get('hypothesis'))
print('before', {k:d.get('before',{}).get(k) for k in ('frames','generation','sequence','desync','resync','reasons')})
print('after ', {k:d.get('after',{}).get(k) for k in ('frames','generation','sequence','desync','resync','reasons')})
print('deltas', d.get('deltas'))
delta = (d.get('after') or {}).get('delta') or {}
print('deltaReasons', delta.get('reasons'))
print('newActivity (first 25):')
for line in (d.get('after') or {}).get('newActivitySample') or [][:25]:
    print(' ', line)
PY
exit "$rc"
