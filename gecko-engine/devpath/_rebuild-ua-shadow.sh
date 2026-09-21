#!/bin/bash
set -euo pipefail
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
CHK=/root/speculum-gecko/checkout
cp -v "$REPO/gecko-engine/patches/dom/base/SpeculumNodeSource.cpp" "$CHK/dom/base/SpeculumNodeSource.cpp"
cp -v "$REPO/gecko-engine/patches/dom/base/SpeculumMutationObserver.cpp" "$CHK/dom/base/SpeculumMutationObserver.cpp"
cd "$CHK/obj-x86_64-pc-linux-gnu/dom/base"
echo "=== objs ==="
ls Speculum*.o 2>/dev/null || echo "(no Speculum*.o yet)"
echo "=== unified ==="
grep -l SpeculumNodeSource Unified*.cpp 2>/dev/null || echo "(not in unified)"
grep -l SpeculumMutationObserver Unified*.cpp 2>/dev/null || echo "(not in unified)"
rm -f SpeculumNodeSource.o SpeculumMutationObserver.o
gmake -j6 SpeculumNodeSource.o SpeculumMutationObserver.o 2>&1 | tee /tmp/make-speculum-ua.log | tail -60
echo "=== done ==="
ls -la SpeculumNodeSource.o SpeculumMutationObserver.o
