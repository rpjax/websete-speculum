#!/usr/bin/env python3
import json
d=json.load(open('/tmp/layout-cssom-diag/layout.json'))
print('brokenImgs', d.get('brokenImgsSample'))
for i in d.get('imgsSample', []):
    print(i)
print('--- critical ---')
for s in d['samples']:
    if s.get('sel') in ('header', 'nav', 'main', '[class*="header"]', '[class*="search"]'):
        print(s['sel'], 'h=', (s.get('rect') or {}).get('h'), 'display=', s.get('display'), 'flex=', s.get('flex'))
