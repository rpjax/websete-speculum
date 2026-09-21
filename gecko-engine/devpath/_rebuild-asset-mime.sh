#!/bin/bash
set -euo pipefail
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
CHK=/root/speculum-gecko/checkout
cp -v "$REPO/gecko-engine/patches/dom/ipc/SpeculumAssetRegistry.cpp" \
  "$CHK/dom/ipc/SpeculumAssetRegistry.cpp"
cd "$CHK/obj-x86_64-pc-linux-gnu/dom/ipc"
rm -f Unified_cpp_dom_ipc2.o
gmake -j6 Unified_cpp_dom_ipc2.o 2>&1 | tee /tmp/make-ipc2.log | tail -40
cd "$CHK"
./mach build binaries 2>&1 | tee /tmp/mach-binaries-asset.log | grep -E "libxul|successful|Error|error:|FAILED" | head -20
bash "$REPO/gecko-engine/devpath/_relink-libxul.sh" | tail -12
# Lab client sniff defense
cd "$REPO/sidecar"
npm run build:lab-client 2>&1 | tail -15
echo DONE
