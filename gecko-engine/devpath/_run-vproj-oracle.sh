#!/bin/bash
set -euo pipefail
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
sed -i 's/\r$//' gecko-engine/devpath/lab-vproj-oracle.mjs
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -4
WAIT_MS=40000 node gecko-engine/devpath/lab-vproj-oracle.mjs \
  'https://www.belezanaweb.com.br/' >/tmp/oracle-out.json 2>/tmp/oracle-err.txt || true
echo EXIT:$?
tail -5 /tmp/oracle-err.txt
python3 <<'PY'
import json
d=json.load(open('/tmp/oracle-out.json'))
print('=== VERDICT ===')
print(json.dumps(d['verdict'], indent=2))
print('=== HUD ===', d['projectedDom']['hud'])
p=d['projectedDom']
print('=== PROJECTED DOM ===')
print({k:p[k] for k in ['iframePresent','htmlLen','bodyHtmlLen','bodyChildren','imgs','scripts','styles','metaCsp','title','textSample']})
print('=== CONSOLE ===', d['consoleHits'])
w=d['wireFromUiSession']
print('=== WIRE UI ===', {k:w[k] for k in ['frameCount','finalTableRows','firstFail']})
for f in w['frameSummaries'][:8]:
  print(' frame', {k:f.get(k) for k in ['n','sequence','generation','resync','bytes','opCount','tableRowsAfter','applyOk','elementNamesTop','applyFail']})
print('=== VIRTUAL ===')
print('navigated', d['virtualSession']['navigated'])
print('snaps', d['virtualSession']['snapshots'])
print('emitted', d['virtualSession']['frameEmitted'][:10])
print('NOTE:', d['designNote_csp'][:160])
PY
