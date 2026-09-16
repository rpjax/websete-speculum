#!/bin/bash
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
# Kill by pid file / port — never pkill -f Speculum (matches repo path).
fuser -k 4077/tcp 4100/tcp 2>/dev/null || true
pkill -x firefox 2>/dev/null || true
pkill -x speculum-lab 2>/dev/null || true
pkill -x speculum-supervisor 2>/dev/null || true
sleep 2
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
export DISPLAY="${DISPLAY:-:0}"
export SPECULUM_BROWSER_HEADLESS="${SPECULUM_BROWSER_HEADLESS:-0}"
export MOZ_LOG=Speculum:5
export MOZ_LOG_FILE=/tmp/speculum-moz-beleza.log
rm -f "$MOZ_LOG_FILE"
cd "$REPO"
nohup bash gecko-engine/devpath/start-lab.sh > /tmp/speculum-lab.log 2>&1 &
echo "start_pid=$! headless=$SPECULUM_BROWSER_HEADLESS display=$DISPLAY"
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:4077/lab/health >/tmp/h.json; then
    echo HEALTH_OK
    cat /tmp/h.json
    echo
    exit 0
  fi
  sleep 3
done
echo HEALTH_FAIL
tail -40 /tmp/speculum-lab.log
exit 1
