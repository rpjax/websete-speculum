#!/usr/bin/env bash
set -euo pipefail
cd ~/speculum-gecko/checkout
export MOZCONFIG="/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/mozconfig"
echo "=== grep Document.cpp ==="
grep -n SPECULUM dom/base/Document.cpp || true
OBJ=$(./mach environment --format=json | python3 -c 'import sys,json; print(json.load(sys.stdin)["topobjdir"])')
MOZ_CRASHREPORTER_DISABLE=1 timeout 30 "$OBJ/dist/bin/firefox" --headless \
  -profile /tmp/pp -no-remote https://example.com > /tmp/direct.log 2>&1 || true
echo "SPECULUM_COUNT=$(grep -c SPECULUM /tmp/direct.log || true)"
echo "WC_LINES=$(wc -l < /tmp/direct.log)"
head -20 /tmp/direct.log
