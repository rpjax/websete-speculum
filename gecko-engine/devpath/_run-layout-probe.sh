#!/bin/bash
set -euo pipefail
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
WAIT_MS=35000 node gecko-engine/devpath/_probe-layout-live.mjs \
  'https://www.belezanaweb.com.br/' | tee /tmp/layout-probe2.json >/dev/null
python3 - <<'PY'
import json
d=json.load(open('/tmp/layout-probe2.json'))
print('ok', d.get('ok'), 'sw', d.get('swController'))
h=d.get('header') or {}
print('header h', h.get('height'), 'rect', h.get('rect'))
logo=(d.get('picked') or {}).get('header img') or {}
print('logo size', logo.get('width'), logo.get('height'), 'rect', logo.get('rect'))
print('logo html', (logo.get('html') or '')[:220])
for i in d.get('imgs') or []:
  if 'logo.svg' in (i.get('src') or ''):
    print('logo img', i)
print('broken', d.get('brokenImgs'))
PY
