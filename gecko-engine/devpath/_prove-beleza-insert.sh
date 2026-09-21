#!/bin/bash
set -euo pipefail
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -5
BOOT_MS="${BOOT_MS:-40000}"
OUT="/tmp/beleza-prove-$(date +%s)"
OUT_DIR="$OUT" BOOT_MS="$BOOT_MS" node gecko-engine/devpath/lab-beleza-diag-apply.mjs \
  "https://www.belezanaweb.com.br/" >"$OUT-report.json" 2>"$OUT-err.txt" || true
python3 - <<PY
import json
from pathlib import Path
rep = json.load(open("$OUT-report.json"))
print("frames", rep.get("frameCount"), "firstFail", rep.get("firstFail"))
print("outDir", rep.get("outDir"))
PY
DIR=$(ls -dt /tmp/beleza-diag-apply-* 2>/dev/null | head -1)
echo "DIR=$DIR"
if [ -n "$DIR" ]; then
  node gecko-engine/devpath/_trace-insert-missing.mjs "$DIR" >"$OUT-trace.txt" 2>&1 || true
  head -30 "$OUT-trace.txt"
fi
curl -sf http://127.0.0.1:4077/lab/health; echo
