#!/bin/bash
# Derruba lab/supervisor/firefox-do-fork e sobe host limpo na 4077.
set -u
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DOTNET_ROOT_X64=/root/.dotnet

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
self=$$

kill_matching() {
  local pat="$1"
  local pid
  for pid in $(pgrep -f "$pat" || true); do
    if [ "$pid" = "$self" ] || [ "$pid" = "$PPID" ]; then
      continue
    fi
    echo "kill $pat pid=$pid"
    kill -9 "$pid" 2>/dev/null || true
  done
}

kill_matching 'Speculum.Lab'
kill_matching 'speculum-lab.dll'
kill_matching 'speculum-supervisor'
kill_matching 'speculum-gecko/checkout/.*/dist/bin/firefox'
fuser -k 4077/tcp 4100/tcp >/dev/null 2>&1 || true
sleep 2

export MOZ_LOG=Speculum:5
export MOZ_LOG_FILE=/tmp/speculum-moz.log
: > /tmp/speculum-lab.log

setsid bash "$REPO/gecko-engine/devpath/start-lab.sh" >> /tmp/speculum-lab.log 2>&1 < /dev/null &
echo "spawned $!"

ok=0
i=0
while [ "$i" -lt 30 ]; do
  i=$((i + 1))
  if curl -sf -m 2 http://127.0.0.1:4077/lab/health > /tmp/speculum-lab-health.json; then
    ok=1
    break
  fi
  sleep 1
done

if [ "$ok" != 1 ]; then
  echo "LAB_UP_FAIL"
  tail -n 80 /tmp/speculum-lab.log
  exit 1
fi

echo LAB_READY
cat /tmp/speculum-lab-health.json
echo
