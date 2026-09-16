#!/bin/bash
# Isonomia same-S DOM+CSSOM Virtual × Projected (Beleza default).
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DISPLAY="${DISPLAY:-:0}"
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
sed -i 's/\r$//' gecko-engine/devpath/lab-same-s-iso.mjs \
  gecko-engine/devpath/_restart-lab-safe.sh 2>/dev/null || true
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -4
OUT_DIR="${OUT_DIR:-$REPO/gecko-engine/devpath/captures/same-s-iso-latest}"
rm -rf "$OUT_DIR"
export OUT_DIR WAIT_MS="${WAIT_MS:-45000}"
set +e
node gecko-engine/devpath/lab-same-s-iso.mjs \
  "${1:-https://www.belezanaweb.com.br/}" | tee /tmp/same-s-iso-out.json
rc=${PIPESTATUS[0]}
set -e
echo "OUT=$OUT_DIR rc=$rc"
python3 - <<'PY'
import json
d=json.load(open('/tmp/same-s-iso-out.json'))
print('=== ISO ===', d.get('oneLiner'))
print('ok', d.get('ok'), 'failed', d.get('failed'))
print('sameS', json.dumps(d.get('sameS'), indent=2))
print('checks:')
for c in d.get('checks') or []:
  mark='PASS' if c.get('pass') else 'FAIL'
  print(f"  {mark} {c.get('id')}: {json.dumps(c.get('detail'), ensure_ascii=False)[:180]}")
planes=d.get('planes') or {}
print('virtual kinds', (planes.get('virtualDump') or {}).get('kinds'))
print('wire kinds', (planes.get('wire') or {}).get('kinds'))
print('tree kinds', (planes.get('projected') or {}).get('treeKinds'))
print('cssomLive', (planes.get('projected') or {}).get('cssomLive'))
print('layout', (planes.get('projected') or {}).get('layout'))
PY
exit "$rc"
