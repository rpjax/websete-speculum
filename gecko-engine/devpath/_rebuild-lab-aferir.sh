#!/bin/bash
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO/gecko-engine/supervisor"
dotnet build src/Speculum.Supervisor/Speculum.Supervisor.csproj -c Release --nologo -v quiet
dotnet build src/Speculum.Lab/Speculum.Lab.csproj -c Release --nologo -v quiet
echo BUILD_OK
pkill -f 'speculum-lab|Speculum.Lab' 2>/dev/null || true
fuser -k 4077/tcp 4100/tcp 2>/dev/null || true
sleep 2
export MOZ_LOG=Speculum:5
export MOZ_LOG_FILE=/tmp/speculum-moz-beleza.log
rm -f "$MOZ_LOG_FILE"
# wrap already used; ensure lab inherits MOZ_LOG
cd "$REPO/gecko-engine/supervisor"
nohup env MOZ_LOG=Speculum:5 MOZ_LOG_FILE=/tmp/speculum-moz-beleza.log \
  /root/.dotnet/dotnet run --project src/Speculum.Lab --no-build -c Release \
  > /tmp/speculum-lab.log 2>&1 &
sleep 5
curl -s http://127.0.0.1:4077/lab/health | head -c 300
echo
