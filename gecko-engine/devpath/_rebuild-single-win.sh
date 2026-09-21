#!/bin/bash
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin
CHK=/root/speculum-gecko/checkout
OBJ="$CHK/obj-x86_64-pc-linux-gnu"
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'

cp -f "$REPO/gecko-engine/patches/dom/ipc/SpeculumProjectionRuntime.cpp" \
  "$CHK/dom/ipc/SpeculumProjectionRuntime.cpp"

cd "$OBJ/dom/ipc"
rm -f Unified_cpp_dom_ipc3.o
echo "=== compile ==="
gmake -j6 Unified_cpp_dom_ipc3.o 2>&1 | tee /tmp/make-sole.log | tail -40
if grep -q ' error:' /tmp/make-sole.log; then
  echo COMPILE_FAIL
  grep ' error:' /tmp/make-sole.log | head -20
  exit 1
fi

echo "=== relink libxul ==="
rm -f "$OBJ/dist/bin/libxul.so"
cd "$OBJ/toolkit/library/build"
gmake -j6 2>&1 | tee /tmp/make-libxul-sole.log | tail -30
ls -la --time-style=full-iso "$OBJ/dist/bin/libxul.so"
strings "$OBJ/dist/bin/libxul.so" | grep -E 'sole chrome|EnsureSole|enforce sole' | head -5
echo DONE
