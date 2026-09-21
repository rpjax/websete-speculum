#!/bin/bash
# Prova numérica: replay DOM apply (phase 1+2) em capturas reais — exit 0 = WIRE=ApplyOK, desync 0.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
node "$REPO/gecko-engine/devpath/projected-replay.mjs" "$REPO/gecko-engine/devpath/captures/20260914-155512-mutation-churn"
node "$REPO/gecko-engine/devpath/projected-replay.mjs" "$REPO/gecko-engine/devpath/captures/20260914-155314-static-dom"
echo "apply-replay-accept: ok"
