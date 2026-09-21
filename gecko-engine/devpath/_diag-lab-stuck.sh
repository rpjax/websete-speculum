#!/bin/bash
set -euo pipefail
echo '=== health ==='
curl -sf http://127.0.0.1:4077/lab/health; echo
echo '=== procs ==='
ps -ww -eo pid,lstart,args | grep -E 'firefox|speculum-lab|speculum-supervisor|Supervisor' | grep -v grep | head -20
echo '=== lab log tail ==='
tail -80 /tmp/speculum-lab.log
echo '=== moz CTX/Ready/Fault ==='
grep -hE 'SPECULUM-CTX|SPECULUM-RUNTIME|Ready|Fault|sole|Fatal|error' /tmp/speculum-moz-beleza.log* 2>/dev/null | tail -50 || true
ls -la /tmp/speculum-moz-beleza.log* 2>/dev/null | tail -10
