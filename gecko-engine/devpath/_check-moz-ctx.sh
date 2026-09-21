#!/bin/bash
set -euo pipefail
echo '=== moz logs CTX ==='
grep -hE 'SPECULUM-CTX|adopt|orphan|browsers=' /tmp/speculum-moz*.log 2>/dev/null | tail -50 || echo none
ls -la /tmp/speculum-moz*.log 2>/dev/null || true
echo '=== lab env ==='
pid=$(pgrep -n -f 'speculum-lab' || true)
echo "lab_pid=$pid"
if [ -n "$pid" ]; then
  tr '\0' '\n' < /proc/$pid/environ | grep -E 'MOZ_LOG|HEADLESS|DISPLAY|BROWSER' || true
fi
echo '=== libxul mtime ==='
ls -la --time-style=full-iso /root/speculum-gecko/checkout/obj-x86_64-pc-linux-gnu/dist/bin/libxul.so
