#!/bin/bash
# Same-S oficial — Halt/Flush/Snapshot multiplano (layout/CSSOM/DOM/asset).
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DISPLAY="${DISPLAY:-:0}"
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
sed -i 's/\r$//' gecko-engine/devpath/lab-same-s-oracle.mjs \
  gecko-engine/devpath/_restart-lab-safe.sh 2>/dev/null || true
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -4
OUT_DIR="${OUT_DIR:-$REPO/gecko-engine/devpath/captures/same-s-latest}"
rm -rf "$OUT_DIR"
export OUT_DIR WAIT_MS="${WAIT_MS:-40000}"
node gecko-engine/devpath/lab-same-s-oracle.mjs \
  "${1:-https://www.belezanaweb.com.br/}" | tee /tmp/same-s-out.json
echo "OUT=$OUT_DIR"
python3 - <<'PY'
import json
d=json.load(open('/tmp/same-s-out.json'))
print('=== SAME-S ===')
print(json.dumps(d.get('sameS'), indent=2))
print('=== VERDICT ===')
print(json.dumps(d.get('verdict'), indent=2))
print('=== LAYOUT ===')
lay=(d.get('projected') or {}).get('layout') or {}
print({k:lay.get(k) for k in ['overlapPairsAmong40','adoptedRules','docSheetRules','brokenImgs','dualHint']})
print('out', d.get('outDir'))
PY
