#!/bin/bash
# Controle do plano CSSOM: folha presente ANTES do bootstrap (link no HTML + construída no parse).
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin:/usr/sbin
export DOTNET_ROOT=/root/.dotnet
export DOTNET_ROOT_X64=/root/.dotnet

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FIX="$REPO/sidecar/browser/mirror/projection/lab/fixtures"

python3 -m http.server 4078 --bind 127.0.0.1 --directory "$FIX" >/tmp/spec-fix-http.log 2>&1 &
HTTP_PID=$!
cleanup() { kill "$HTTP_PID" 2>/dev/null || true; }
trap cleanup EXIT
sleep 0.4

echo "== restart lab (frio) =="
bash "$HERE/_restart-lab-safe.sh" | tail -2

cd "$REPO"
FIXTURE_URL="http://127.0.0.1:4078/cssom-early-sheet.html" \
  SETTLE_MS="${SETTLE_MS:-16000}" \
  node gecko-engine/devpath/lab-cssom-late-sheet.mjs > /tmp/cssom-early.json 2>/tmp/cssom-early.err || true

python3 - <<'PY'
import json
d = json.load(open('/tmp/cssom-early.json'))
print('virtualSelfReport', json.dumps(d['virtualSelfReport']))
print('painted          ', json.dumps(d['projected']['painted']))
print('projectedSheets  ', json.dumps(d['projected']['projectedSheetHrefs']))
print('virtualTableDump ', json.dumps(d['virtualTableDump']))
print('sameS            ', json.dumps(d['sameS']))
print('wire             ', json.dumps(d['wire']))
for p in d['perMark']:
    print('perMark          ', json.dumps(p))
PY
