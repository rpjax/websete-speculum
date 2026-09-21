#!/usr/bin/env bash
set -euo pipefail
cd ~/speculum-gecko/checkout
export MOZCONFIG="/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/mozconfig"
OBJ=$(./mach environment --format=json 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin)["topobjdir"])')
echo "LIBXUL_SPECULUM_COUNT=$(strings "$OBJ/dist/bin/libxul.so" | grep -c SPECULUM)"
MOZ_CRASHREPORTER_DISABLE=1 timeout 60 ./mach run --headless \
  --setpref gfx.webrender.software=true https://example.com > /tmp/run.log 2>&1 || true
echo "RUN_LOG_SPECULUM_COUNT=$(grep -c SPECULUM /tmp/run.log || true)"
tail -30 /tmp/run.log
