#!/usr/bin/env bash
set -euo pipefail
cd ~/speculum-gecko/checkout
python3 << 'PY'
from pathlib import Path
p = Path("dom/base/Document.cpp")
lines = p.read_text().splitlines()
attach = "  SpeculumAttachMutationObserverToDocument(this);"
fprintf = '  fprintf(stderr, "[SPECULUM-CTOR]\\n");'
out = []
i = 0
while i < len(lines):
    if lines[i] == attach and i + 1 < len(lines) and lines[i + 1] == fprintf:
        out.append(fprintf)
        out.append(attach)
        i += 2
        continue
    out.append(lines[i])
    i += 1
p.write_text("\n".join(out) + "\n")
for j, ln in enumerate(out):
    if "SPECULUM" in ln or "SpeculumAttach" in ln:
        print(f"{j+1}: {ln}")
PY
export MOZCONFIG="/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/mozconfig"
./mach build binaries 2>&1 | tail -3
OBJ=$(./mach environment --format=json | python3 -c 'import sys,json; print(json.load(sys.stdin)["topobjdir"])')
MOZ_CRASHREPORTER_DISABLE=1 timeout 30 "$OBJ/dist/bin/firefox" --headless \
  -profile /tmp/pp2 -no-remote https://example.com > /tmp/d2.log 2>&1 || true
echo "SPECULUM_COUNT=$(grep -c SPECULUM /tmp/d2.log || true)"
tail -5 /tmp/d2.log
