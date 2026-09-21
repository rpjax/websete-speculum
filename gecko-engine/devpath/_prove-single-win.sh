#!/bin/bash
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DISPLAY=:0
export SPECULUM_BROWSER_HEADLESS=0
export MOZ_LOG=Speculum:5
export MOZ_LOG_FILE=/tmp/speculum-moz-beleza.log
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
rm -f /tmp/speculum-moz-beleza.log*
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -5
OUT_DIR=/tmp/sole-probe WAIT_MS=15000 \
  node gecko-engine/devpath/lab-arm-capture.mjs 'https://example.com/' 15000 \
  >/tmp/sole-probe.json 2>/tmp/sole-probe.err || true
sleep 1
echo '=== CTX ==='
grep -hE 'SPECULUM-CTX|sole chrome|enforce sole' /tmp/speculum-moz-beleza.log* 2>/dev/null | tail -30
echo '=== summary ==='
python3 - <<'PY'
import json
d=json.load(open('/tmp/sole-probe.json'))
print('nav', d.get('navigated'), 'rows', d.get('maxTableSize'), 'frames', d.get('binaryFrames'))
PY
