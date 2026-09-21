#!/bin/bash
# Rebuild após filtro C6 no-double-emit (`SpeculumIsCssomPlaneSheet`).
set -euo pipefail
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
CHK=/root/speculum-gecko/checkout
cp -v "$REPO/gecko-engine/patches/dom/base/SpeculumNodeSource.cpp" "$CHK/dom/base/SpeculumNodeSource.cpp"
cp -v "$REPO/gecko-engine/patches/dom/base/SpeculumCssom.cpp" "$CHK/dom/base/SpeculumCssom.cpp"
cp -v "$REPO/gecko-engine/patches/dom/base/SpeculumCssom.h" "$CHK/dom/base/SpeculumCssom.h"
cp -v "$REPO/gecko-engine/patches/dom/base/SpeculumMutationObserver.cpp" "$CHK/dom/base/SpeculumMutationObserver.cpp"
cd "$CHK/obj-x86_64-pc-linux-gnu/dom/base"
rm -f Unified_cpp_dom_base6.o
gmake -j6 Unified_cpp_dom_base6.o 2>&1 | tee /tmp/make-u6b.log | tail -20
cd "$CHK"
./mach build binaries 2>&1 | tee /tmp/mach-binaries-moz.css.log | grep -E "libxul|successful|Error|error:" | head -20
bash "$REPO/gecko-engine/devpath/_relink-libxul.sh" | tail -15
echo DONE
