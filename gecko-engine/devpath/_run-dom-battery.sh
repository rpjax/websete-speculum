#!/bin/bash
# Bateria DOM via python :4078 (text/html). Sem mach. Sock proprio, porta 4199.
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin:/usr/sbin
export DOTNET_ROOT=/root/.dotnet
export DOTNET_ROOT_X64=/root/.dotnet

HERE="$(cd "$(dirname "$0")" && pwd)"
FIX="$HERE/../../sidecar/browser/mirror/projection/lab/fixtures"
BASE="http://127.0.0.1:4078"

python3 -m http.server 4078 --bind 127.0.0.1 --directory "$FIX" >/tmp/spec-fix-http.log 2>&1 &
HTTP_PID=$!
cleanup() { kill "$HTTP_PID" 2>/dev/null || true; }
trap cleanup EXIT
sleep 0.3
curl -sf "$BASE/static-dom.html" >/dev/null

export SPECULUM_SUPERVISOR_PORT=4199
export SPECULUM_SUPERVISOR_WS="ws://127.0.0.1:4199/session"
export SPECULUM_BROWSER_SOCKET="/tmp/speculum-battery.sock"

SUMMARY="$HERE/captures/battery-$(date +%Y%m%d-%H%M%S).txt"
mkdir -p "$HERE/captures"
echo "bateria DOM $(date -Iseconds)  $BASE" | tee "$SUMMARY"
echo | tee -a "$SUMMARY"

run_one() {
  local label="$1"
  local timeout="$2"
  local path="$3"
  local url="$BASE/$path"
  echo "==== $label  ${timeout}s  $url ====" | tee -a "$SUMMARY"
  TIMEOUT="$timeout" "$HERE/capture.sh" "$url" "$label" | tee -a "$SUMMARY"
  local cap
  cap="$(ls -dt "$HERE"/captures/*-"$label" | head -1)"
  local nframes nbytes
  nframes="$(ls "$cap"/f-*.bin 2>/dev/null | wc -l | tr -d ' ')"
  nbytes="$(python3 -c "import json,pathlib
p=pathlib.Path(r'''$cap''')/'frames.ndjson'
b=0; n=0
if p.exists():
  for line in p.read_text().splitlines():
    if line.strip():
      n+=1; b+=json.loads(line).get('bytes',0)
print(n,b)")"
  echo "stats $label frames_bytes=$nbytes" | tee -a "$SUMMARY"
  if "$HERE/verify.sh" "$cap" | tee -a "$SUMMARY"; then
    echo "RESULT $label PASS frames=$nframes" | tee -a "$SUMMARY"
  else
    echo "RESULT $label FAIL frames=$nframes" | tee -a "$SUMMARY"
  fi
  echo | tee -a "$SUMMARY"
}

run_one static-dom 20 static-dom.html
run_one forms-state 20 forms-state.html
run_one svg-ns 20 svg-ns.html
run_one insert-before-remove 25 insert-before-remove.html
run_one mutation-churn 30 mutation-churn.html
run_one anim-js 30 "anim-js.html?fps=30"
run_one iframe-open 30 iframe-open.html
run_one prepend-stress 45 prepend-stress.html
run_one stress-churn 45 stress-churn.html

echo "==== RESUMO ====" | tee -a "$SUMMARY"
grep '^RESULT ' "$SUMMARY" | tee -a "$SUMMARY"
echo "summary: $SUMMARY"
