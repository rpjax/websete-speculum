#!/bin/bash
set -euo pipefail
echo '=== sizes ==='
wc -c /tmp/singlewin-probe.json /tmp/singlewin-probe.err /tmp/speculum-lab.log 2>/dev/null || true
echo '=== err ==='
tail -40 /tmp/singlewin-probe.err 2>/dev/null || true
echo '=== json summary ==='
python3 - <<'PY'
import json
try:
  d=json.load(open('/tmp/singlewin-probe.json'))
  print({k:d.get(k) for k in ('navigated','maxTableSize','binaryFrames','url','waitMs')})
except Exception as e:
  print('json_err',e)
PY
echo '=== lab tail ==='
tail -50 /tmp/speculum-lab.log
echo '=== moz files ==='
ls -la /tmp/speculum-moz* 2>/dev/null || true
