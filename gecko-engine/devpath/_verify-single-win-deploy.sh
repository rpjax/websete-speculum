#!/bin/bash
set -euo pipefail
FF=/root/speculum-gecko/checkout/obj-x86_64-pc-linux-gnu/dist/bin/firefox
LIBXUL=/root/speculum-gecko/checkout/obj-x86_64-pc-linux-gnu/dist/bin/libxul.so
echo "=== binary mtimes ==="
ls -la --time-style=full-iso "$FF" "$LIBXUL"
stat -c '%y %n' "$LIBXUL"
echo "=== Adopt in source ==="
grep -n 'AdoptOrOpen\|CloseOrphan\|adopted=' \
  /root/speculum-gecko/checkout/dom/ipc/SpeculumProjectionRuntime.cpp | head -15
echo "=== strings libxul SPECULUM-CTX ==="
strings "$LIBXUL" | grep -E 'SPECULUM-CTX|adopted=' | head -10 || echo 'NO_STRINGS'
echo "=== running procs ==="
ps -ww -eo pid,lstart,args | grep -E 'firefox|Speculum|speculum|4077' | grep -v grep | head -20
echo "=== firefox open files /exe ==="
for p in $(pgrep -x firefox || true); do
  echo "pid=$p"
  ls -l /proc/$p/exe
  stat -c '%y' /proc/$p/exe
done
echo "=== moz/lab logs CTX ==="
grep -hE 'SPECULUM-CTX|adopted=' /tmp/speculum-moz*.log /tmp/speculum-lab.log 2>/dev/null | tail -30 || true
