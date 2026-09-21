#!/bin/bash
set -euo pipefail
echo '=== probe ==='
ls -la /tmp/sole-probe.json /tmp/sole-probe.err 2>/dev/null || true
python3 - <<'PY'
import json, pathlib
p=pathlib.Path('/tmp/sole-probe.json')
print('size', p.stat().st_size if p.exists() else None)
if p.exists() and p.stat().st_size:
  d=json.load(open(p))
  print({k:d.get(k) for k in ('navigated','maxTableSize','binaryFrames','url')})
  print('errkeys', [k for k in d if 'err' in k.lower() or k=='error'])
PY
echo '=== err ==='
cat /tmp/sole-probe.err 2>/dev/null | tail -20
echo '=== moz ==='
ls -la /tmp/speculum-moz-beleza.log* 2>/dev/null | head
grep -hE 'SPECULUM-CTX|Fault|sole' /tmp/speculum-moz-beleza.log* 2>/dev/null | tail -40
echo '=== lab ==='
grep -E 'Fault|sole|ContextCreate|OpenWindow|encerr' /tmp/speculum-lab.log | tail -40
