#!/bin/bash
# GECKO-CSSOM-FOLHA-TARDIA — A/B de folha tardia no lab frio.
# Fixture servida em :4078 por http.server (content-type certo; a rota /fixtures do
# lab .NET devolve octet-stream — mesmo motivo de _probe-one.sh).
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
curl -sf -D - -o /dev/null "http://127.0.0.1:4078/cssom-late-sheet.css" | grep -i '^content-type'

echo "== restart lab (frio) =="
bash "$HERE/_restart-lab-safe.sh" | tail -3

cd "$REPO"
FIXTURE_URL="http://127.0.0.1:4078/cssom-late-sheet.html" \
  SETTLE_MS="${SETTLE_MS:-20000}" \
  node gecko-engine/devpath/lab-cssom-late-sheet.mjs
