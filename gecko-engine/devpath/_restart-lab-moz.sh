#!/bin/bash
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
pkill -f 'speculum-lab|Speculum.Lab|speculum-supervisor|firefox' 2>/dev/null || true
fuser -k 4077/tcp 4100/tcp 2>/dev/null || true
sleep 2
export MOZ_LOG=Speculum:5
export MOZ_LOG_FILE=/tmp/speculum-moz-beleza.log
rm -f "$MOZ_LOG_FILE"
bash "$REPO/gecko-engine/devpath/start-lab.sh" > /tmp/speculum-lab.log 2>&1 &
sleep 6
curl -s http://127.0.0.1:4077/lab/health | head -c 250
echo
