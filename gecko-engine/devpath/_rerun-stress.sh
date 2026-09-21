#!/bin/bash
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin:/usr/sbin
export DOTNET_ROOT=/root/.dotnet
export DOTNET_ROOT_X64=/root/.dotnet

HERE="$(cd "$(dirname "$0")" && pwd)"
FIX="$HERE/../../sidecar/browser/mirror/projection/lab/fixtures"
BASE="http://127.0.0.1:4078"

if ! curl -sf "$BASE/static-dom.html" >/dev/null; then
  python3 -m http.server 4078 --bind 127.0.0.1 --directory "$FIX" >/tmp/spec-fix-http.log 2>&1 &
  echo $! > /tmp/spec-fix-http.pid
  sleep 0.4
fi

export SPECULUM_SUPERVISOR_PORT=4199
export SPECULUM_SUPERVISOR_WS="ws://127.0.0.1:4199/session"
export SPECULUM_BROWSER_SOCKET="/tmp/speculum-battery.sock"

SUMMARY="$HERE/captures/battery-stress-$(date +%Y%m%d-%H%M%S).txt"
echo "re-stress $(date -Iseconds)" | tee "$SUMMARY"

run_one() {
  local label="$1"
  local timeout="$2"
  local path="$3"
  echo "==== $label ====" | tee -a "$SUMMARY"
  TIMEOUT="$timeout" "$HERE/capture.sh" "$BASE/$path" "$label" | tee -a "$SUMMARY"
  local cap
  cap="$(ls -dt "$HERE"/captures/*-"$label" | head -1)"
  local firstseq
  firstseq="$(python3 -c "import json,pathlib; p=pathlib.Path(r'''$cap''')/'frames.ndjson';
print(json.loads(p.read_text().splitlines()[0])['sequence'] if p.exists() and p.read_text().strip() else 'na')")"
  echo "first_seq=$firstseq" | tee -a "$SUMMARY"
  set +e
  "$HERE/verify.sh" "$cap" > /tmp/spec-verify-out.txt
  local ec=$?
  set -e
  tail -8 /tmp/spec-verify-out.txt | tee -a "$SUMMARY"
  if [ "$ec" -eq 0 ]; then
    echo "RESULT $label PASS first_seq=$firstseq" | tee -a "$SUMMARY"
  else
    echo "RESULT $label FAIL first_seq=$firstseq" | tee -a "$SUMMARY"
  fi
}

run_one anim-js 30 "anim-js.html?fps=30"
run_one prepend-stress 45 prepend-stress.html
run_one stress-churn 45 stress-churn.html
grep '^RESULT ' "$SUMMARY"
