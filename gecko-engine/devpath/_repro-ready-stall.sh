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

rm -f /tmp/speculum-moz-beleza.log* /tmp/stuck-diag.json
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -3

OUT_DIR=/tmp/stuck-diag WAIT_MS=45000 \
  node gecko-engine/devpath/lab-arm-capture.mjs 'https://www.belezanaweb.com.br/' 45000 \
  >/tmp/stuck-diag.json 2>/tmp/stuck-diag.err &
CAP=$!

for i in $(seq 1 25); do
  sleep 2
  echo "--- t=$((i*2))s ---"
  grep -E 'Ready|pronto|Fault|sole|apresentou|conectad|ContextCreate|encerr|Fatal|frames' /tmp/speculum-lab.log | tail -10 || true
  if grep -q 'browser pronto' /tmp/speculum-lab.log 2>/dev/null; then
    echo GOT_READY
    break
  fi
  if ! kill -0 $CAP 2>/dev/null; then
    echo CAPTURE_EXITED
    break
  fi
done

wait $CAP || true
echo '=== moz ==='
grep -hE 'SPECULUM|Ready|sole|Fatal' /tmp/speculum-moz-beleza.log* 2>/dev/null | tail -40 || true
echo '=== json ==='
python3 -c "import json;d=json.load(open('/tmp/stuck-diag.json'));print({k:d.get(k) for k in ('navigated','maxTableSize','binaryFrames')})" 2>/dev/null || echo 'no json'
echo '=== err ==='
tail -20 /tmp/stuck-diag.err 2>/dev/null || true
echo DONE
