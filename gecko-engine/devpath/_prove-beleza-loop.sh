#!/bin/bash
set -euo pipefail
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
sed -i 's/\r$//' gecko-engine/devpath/_trace-insert-missing.mjs

echo '=== GOOD73 ==='
node gecko-engine/devpath/_trace-insert-missing.mjs /tmp/beleza-diag-apply-1789532248079 2>&1 | tail -5

echo '=== FAIL177 ==='
node gecko-engine/devpath/_trace-insert-missing.mjs /tmp/beleza-diag-apply-1789532721572 2>&1 | head -40 || true

for i in 1 2 3 4; do
  set +e
  echo "=== TRY $i ==="
  bash gecko-engine/devpath/_restart-lab-safe.sh >"/tmp/rst$i.out" 2>&1
  tail -2 "/tmp/rst$i.out"
  BOOT_MS=40000 node gecko-engine/devpath/lab-beleza-diag-apply.mjs \
    'https://www.belezanaweb.com.br/' >"/tmp/try$i.json" 2>"/tmp/try$i.err"
  DIR=$(grep -oE '/tmp/beleza-diag-apply-[0-9]+' "/tmp/try$i.err" | tail -1 || true)
  python3 - "$i" "$DIR" <<'PY'
import json, sys
i, d = sys.argv[1], sys.argv[2]
rep = json.load(open(f'/tmp/try{i}.json'))
ff = rep.get('firstFail')
print(f'try{i} frames={rep.get("frameCount")} dir={d} fail={None if not ff else (ff.get("opName"), ff.get("message"), ff.get("id"))}')
PY
  FC=$(python3 -c "import json; print(json.load(open('/tmp/try$i.json')).get('frameCount') or 0)")
  if [ "${FC:-0}" -gt 20 ] && [ -n "$DIR" ]; then
    node gecko-engine/devpath/_trace-insert-missing.mjs "$DIR" >"/tmp/try$i-trace.txt" 2>&1
    head -30 "/tmp/try$i-trace.txt"
    bash gecko-engine/devpath/_restart-lab-safe.sh >"/tmp/rst-desync.out" 2>&1
    WAIT_MS=50000 node gecko-engine/devpath/lab-desync-probe.mjs \
      'https://www.belezanaweb.com.br/' >"/tmp/try$i-desync.json" 2>"/tmp/try$i-desync.err"
    python3 - <<PY
import json
try:
  d=json.load(open('/tmp/try$i-desync.json'))
  print('desync_probe', d.get('summary'), {k:d.get('hud',{}).get(k) for k in ['frames','apply','desync','resync','bodyLen','build']})
except Exception as e:
  print('desync_probe_err', e)
  print(open('/tmp/try$i-desync.err').read()[-800:])
PY
    break
  fi
done
set -e
echo DONE
