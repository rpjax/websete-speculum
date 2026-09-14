#!/bin/bash
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin:/usr/sbin
export DOTNET_ROOT=/root/.dotnet
export DOTNET_ROOT_X64=/root/.dotnet

HERE="$(cd "$(dirname "$0")" && pwd)"
FIX="$HERE/../../sidecar/browser/mirror/projection/lab/fixtures"
# file:// ja projetou mutacoes.html. Servidor proprio pra iframe relativo + content-type.
python3 -m http.server 4078 --bind 127.0.0.1 --directory "$FIX" >/tmp/spec-fix-http.log 2>&1 &
HTTP_PID=$!
sleep 0.4
curl -sf -D - -o /dev/null "http://127.0.0.1:4078/static-dom.html" | head -20

export SPECULUM_SUPERVISOR_PORT=4199
export SPECULUM_SUPERVISOR_WS="ws://127.0.0.1:4199/session"
export SPECULUM_BROWSER_SOCKET="/tmp/speculum-battery.sock"
export TIMEOUT=25

"$HERE/capture.sh" "http://127.0.0.1:4078/static-dom.html" "probe-static"
kill "$HTTP_PID" 2>/dev/null || true
echo "---- supervisor (Navigated/frames) ----"
grep -E "Navigated|navegou|frames,|Fault|ContextCreated" "$HERE"/captures/*-probe-static/logs/supervisor.log | tail -20
echo "---- verify ----"
"$HERE/verify.sh" "$(ls -d "$HERE"/captures/*-probe-static | tail -1)" || true
