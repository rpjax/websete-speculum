#!/bin/bash
set -euo pipefail
python3 <<'PY'
import json
from collections import Counter
d=json.load(open('/tmp/projected-cssom-probe2/projected-cssom.json'))
by=Counter()
rules=0
for s in d['sheets']:
    by[s['origin']] += 1
    if s['rules'] is not None:
        rules += s['rules']
print('=== PROJECTED CSSOM ===')
print('sheets by origin', dict(by))
print('total rules', rules)
print('field readableRules', d.get('readableRules'))
print('unreadable', d['unreadable'], 'empty', d['emptySheets'])
print('styleEls', d['styleEls'], 'linkCss', d['linkCss'])
print('hud', d['hud'])
print('Virtual dump: Sheet=4 Rule=4912')
print('delta rules (projected - virtual)', rules - 4912)
PY
sed -i 's/lastResyncCssom,/resyncCssom,/' \
  '/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/devpath/_analyze-cssom-capture.mjs'
cd '/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
node gecko-engine/devpath/_analyze-cssom-capture.mjs /tmp/same-s-cssom
