#!/bin/bash
set -euo pipefail
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
PROBE="file://${REPO}/sidecar/browser/mirror/projection/lab/fixtures/probe-gfx.html"

run_probe() {
  local arm=$1
  local envh=$2
  export SPECULUM_BROWSER_HEADLESS=$envh
  echo "==== probe $arm HEADLESS=$envh ===="
  bash gecko-engine/devpath/_restart-lab-safe.sh | tail -2
  OUT_DIR="/tmp/probe-$arm" WAIT_MS=15000 \
    node gecko-engine/devpath/lab-arm-capture.mjs "$PROBE" 15000 \
    >"/tmp/probe-$arm.json" 2>"/tmp/probe-$arm.err" || true
  python3 - "$arm" "$envh" <<'PY'
import json, sys
arm, envh = sys.argv[1], sys.argv[2]
d = json.load(open(f'/tmp/probe-{arm}.json'))
print(f'ARM {arm} HEADLESS={envh}')
print(' bin', d.get('binaryFrames'), 'nav', d.get('navigated'), 'max', d.get('maxTableSize'), 'dump', d.get('lastDumpRows'))
print(' probe', json.dumps(d.get('probe'), indent=2)[:800] if d.get('probe') else None)
print(' markers', (d.get('textMarkers') or [])[:2])
PY
  if [ -d "/tmp/probe-$arm" ]; then
    node gecko-engine/devpath/_dump-frame-content.mjs "/tmp/probe-$arm" 2>/dev/null \
      | python3 -c 'import sys,json;d=json.load(sys.stdin);print(" tags",sorted({e["name"] for e in d["els"]}));print(" texts",[t["value"][:120] for t in d["texts"] if t["value"].strip()][:6])' || true
  fi
}

run_probe headless 1
run_probe headed 0
