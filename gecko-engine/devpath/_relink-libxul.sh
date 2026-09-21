#!/bin/bash
set -euo pipefail
OBJ=/root/speculum-gecko/checkout/obj-x86_64-pc-linux-gnu
# Unified .o already rebuilt; force libxul relink into dist/bin
rm -f "$OBJ/dist/bin/libxul.so"
# Also clear any intermediate stamp
rm -f "$OBJ/toolkit/library/build/.deps/libxul.so"* 2>/dev/null || true
cd "$OBJ/toolkit/library/build"
echo "=== gmake default in toolkit/library/build ==="
gmake -j6 2>&1 | tee /tmp/make-libxul2.log | tail -60
ls -la --time-style=full-iso "$OBJ/dist/bin/libxul.so"
strings "$OBJ/dist/bin/libxul.so" | grep -E 'close orphans|adopt existing|open new \(no' | head -5 || echo 'STRINGS_MISSING'
echo DONE
