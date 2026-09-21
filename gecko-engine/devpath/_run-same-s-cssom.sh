#!/bin/bash
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DISPLAY="${DISPLAY:-:0}"
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
sed -i 's/\r$//' gecko-engine/devpath/_restart-lab-safe.sh \
  gecko-engine/devpath/lab-same-s-oracle.mjs \
  gecko-engine/devpath/_png-nonwhite.py
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -5
export OUT_DIR=/tmp/same-s-cssom
export WAIT_MS="${WAIT_MS:-45000}"
rm -rf "$OUT_DIR"
node gecko-engine/devpath/lab-same-s-oracle.mjs \
  'https://www.belezanaweb.com.br/' >/tmp/same-s-out.json 2>/tmp/same-s-err.txt || true
echo EXIT:$?
tail -8 /tmp/same-s-err.txt
python3 <<'PY'
import json
from collections import Counter
from pathlib import Path

d = json.load(open('/tmp/same-s-out.json'))
print('=== VERDICT ===')
print(json.dumps(d['verdict'], indent=2))
print('=== COMPARE ===')
print(json.dumps(d['compare'], indent=2, default=str))
v = (d.get('virtual') or {}).get('dump') or {}
kind = {
    '0': 'Element', '1': 'Text', '2': 'Comment', '3': 'Document',
    '4': 'Sheet', '5': 'Rule', '6': 'Attr?', '7': 'ShadowRoot',
}
kh = v.get('kindHist') or {}
print('=== VIRTUAL kindHist ===')
for k, n in sorted(kh.items(), key=lambda x: int(x[0])):
    print(f'  {k} {kind.get(str(k), "?")}: {n}')
print('rowCount', v.get('rowCount'), 'seq', v.get('sequence'), 'hash', v.get('tableHash'))
print('=== WIRE table ===')
print(d['wire']['table'])
print('content', d['wire']['contentFromLastResync'])
print('=== PROJECTED DOM ===')
print(json.dumps(d['projectedDom'], indent=2)[:2000])
print('=== PIXELS ===')
print(d['projectedPixels'])
print('=== PROJECTED SNAP ===')
print(d.get('projectedSnapResult'))
print('out', d['outDir'])

# Count CSSOM opcodes on the wire from saved bins if present
outdir = Path(d['outDir'])
bins = sorted(outdir.glob('f-*.bin'))
print('bins', len(bins))
PY
