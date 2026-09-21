#!/usr/bin/env python3
import json
d=json.load(open('/tmp/layout-cssom-diag/summary.json'))
print('=== DRY RUN insertRule ===')
print(json.dumps(d['dryRun'], indent=2)[:4000])
print('=== SAMPLES ===')
for s in d['layout'].get('samples',[]):
    print(
        s.get('sel'),
        'MISSING' if s.get('missing') else '',
        'display=', s.get('display'),
        'flex=', s.get('flex'),
        'grid=', s.get('grid'),
        'rect=', s.get('rect'),
        'bg=', s.get('bg'),
    )
print('overlaps', d['layout'].get('overlapPairsAmong40'))
print('adopted', d['layout'].get('adoptedRules'), 'docSheets', d['layout'].get('docSheetRules'))
print('brokenImgs', d['layout'].get('brokenImgsSample'))
print('bodyBg', d['layout'].get('bodyBg'))
print('hud', d['layout'].get('hud'))
