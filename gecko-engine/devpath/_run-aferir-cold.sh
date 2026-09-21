#!/bin/bash
set -euo pipefail
export PATH=/usr/bin:/bin
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
echo '=== example.com cold ==='
EXPLICIT_NAV=0 BOOT_MS=20000 COLD_MARKS=5000,10000,20000 AFERIR_OUT=/tmp/aferir-example.json \
  node gecko-engine/devpath/lab-beleza-aferir.mjs 'https://example.com/' 2>/tmp/aferir-example.err | tee /tmp/aferir-example.out | tail -40
echo '=== beleza cold ==='
EXPLICIT_NAV=0 BOOT_MS=25000 COLD_MARKS=5000,15000,25000 AFERIR_OUT=/tmp/aferir-beleza-cold.json \
  node gecko-engine/devpath/lab-beleza-aferir.mjs 'https://www.belezanaweb.com.br/' 2>/tmp/aferir-beleza-cold.err | tee /tmp/aferir-beleza-cold.out | tail -50
echo '=== lab log nav lines ==='
grep -E 'Navigate |navegou|ContextCreated|browse.start|Fault|falha' /tmp/speculum-lab.log | tail -40
echo '=== moz log (head) ==='
if [[ -f /tmp/speculum-moz-beleza.log ]]; then
  grep -E 'SPECULUM-CTRL|LoadURI|Navigated|ContextCreated|WaitFor' /tmp/speculum-moz-beleza.log | tail -60
else
  echo 'no moz log'
fi
