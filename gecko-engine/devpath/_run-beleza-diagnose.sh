#!/bin/bash
# Tap 4100 enquanto o lab Browse Beleza roda no Windows (supervisor compartilhado).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$REPO/gecko-engine/devpath/captures/$(date +%Y%m%d-%H%M%S)-beleza-diagnose"
DUR=200
cd "$REPO/gecko-engine/devpath"
sleep 8
npx --yes tsx capture.ts "$OUT" "ws://127.0.0.1:4100/session" "$DUR"
echo "OUT=$OUT"
ls "$OUT"/f-*.bin 2>/dev/null | wc -l
