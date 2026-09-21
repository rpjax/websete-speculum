#!/bin/bash
set -euo pipefail
echo '=== lab health ==='
curl -sf http://127.0.0.1:4077/lab/health || echo HEALTH_DOWN
echo
echo '=== lab env ==='
pid=$(pgrep -n -f 'speculum-lab' || true)
echo "lab_pid=$pid"
if [ -n "$pid" ]; then
  tr '\0' '\n' < /proc/$pid/environ | grep -E 'HEADLESS|DISPLAY|BROWSER_BIN|MOZ_LOG' || true
fi
echo '=== libxul ==='
ls -la --time-style=full-iso /root/speculum-gecko/checkout/obj-x86_64-pc-linux-gnu/dist/bin/libxul.so
strings /root/speculum-gecko/checkout/obj-x86_64-pc-linux-gnu/dist/bin/libxul.so | grep -E 'Ready — sole chrome|PrepareSoleChrome' | head -3
echo '=== firefox running? ==='
ps -ww -o pid,args -C firefox 2>/dev/null | head -3 || echo '(none — sobe no Start Virtual)'
