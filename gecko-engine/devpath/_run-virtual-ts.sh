#!/bin/bash
set -euo pipefail
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
sed -i 's/\r$//' gecko-engine/devpath/lab-virtual-timeseries.mjs
# limpa sessão zumbi
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -3
TOTAL_MS=60000 SNAP_EVERY_MS=5000 node gecko-engine/devpath/lab-virtual-timeseries.mjs \
  'https://www.belezanaweb.com.br/' >/tmp/vts-out.json 2>/tmp/vts-err.txt || true
echo EXIT:$?
tail -3 /tmp/vts-err.txt
python3 <<'PY'
import json,re,glob,os
d=json.load(open('/tmp/vts-out.json'))
print('=== ANALYSIS ===')
print(json.dumps(d['analysis'], indent=2))
print('=== NAVIGATED ===')
print(d['navigated'])
print('=== DUMPS ===')
for x in d['dumps']:
  print(x)
print('=== FRAME_EMITTED tableSize series ===')
for f in d['frameEmitted']:
  print(f"{f['elapsedMs']}ms seq={f['sequence']} rows={f['tableSize']} resync={f['resync']} bytes={f['bytes']}")
print('binary', d['binaryFrames'], 'faults', d['faults'])
# logs
print('=== LAB LOG clues ===')
log='/tmp/speculum-lab.log'
if os.path.isfile(log):
  txt=open(log,errors='ignore').read().splitlines()
  keys=('akam','Akamai','403','denied','challenge','bot','LoadState','Navigated','fault','pixel','Tl2xe')
  for line in txt[-200:]:
    if any(k.lower() in line.lower() for k in keys):
      print(line[-220:])
print('=== MOZ LOG ===')
for p in sorted(glob.glob('/tmp/speculum-moz*.log'))[-2:]:
  print('file', p)
  txt=open(p,errors='ignore').read().splitlines()
  for line in txt[-80:]:
    if any(k in line.lower() for k in ('akam','error','fault','speculum','challenge','blocked','csp')):
      print(line[-200:])
# last dossier
runs=sorted(glob.glob('/tmp/speculum-lab-runs/*'))
if runs:
  last=runs[-1]
  print('=== DOSSIER', last, '===')
  for f in os.listdir(last)[:20]:
    print(' ', f)
  man=os.path.join(last,'manifest.json')
  if os.path.isfile(man):
    print(open(man).read()[:800])
  tel=os.path.join(last,'telemetry.ndjson')
  if os.path.isfile(tel):
    rows=open(tel).read().splitlines()[-15:]
    for r in rows:
      print(r[:300])
PY
