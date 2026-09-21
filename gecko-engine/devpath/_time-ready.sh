#!/bin/bash
set -uo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DISPLAY=:0
export SPECULUM_BROWSER_HEADLESS=0
export MOZ_LOG=Speculum:5
export MOZ_LOG_FILE=/tmp/speculum-moz-beleza.log
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
rm -f /tmp/speculum-moz-beleza.log*
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -3

# Time Hello → Ready
OUT_DIR=/tmp/ready-time WAIT_MS=25000 \
  node gecko-engine/devpath/lab-arm-capture.mjs 'https://example.com/' 25000 \
  >/tmp/ready-time.json 2>/tmp/ready-time.err &
CAP=$!
START=$(date +%s%3N)
HELLO_T=0
READY_T=0
for i in $(seq 1 40); do
  sleep 0.5
  if [ "$HELLO_T" = 0 ] && grep -q 'apresentou-se' /tmp/speculum-lab.log; then
    HELLO_T=$(( $(date +%s%3N) - START ))
    echo "HELLO_MS=$HELLO_T"
  fi
  if grep -q 'browser pronto' /tmp/speculum-lab.log; then
    READY_T=$(( $(date +%s%3N) - START ))
    echo "READY_MS=$READY_T"
    break
  fi
  kill -0 $CAP 2>/dev/null || break
done
wait $CAP || true
grep -hE 'sole chrome|Ready —' /tmp/speculum-moz-beleza.log* | tail -5
python3 -c "import json;d=json.load(open('/tmp/ready-time.json'));print('nav',d.get('navigated'),'frames',d.get('binaryFrames'))"
echo DONE
