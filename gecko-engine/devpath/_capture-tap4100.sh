#!/bin/bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$REPO/gecko-engine/devpath/captures/$(date +%Y%m%d-%H%M%S)-beleza-tap4100"
cd "$REPO/gecko-engine/devpath"
DUR="${DUR:-180}"
npx --yes tsx capture.ts "$OUT" "ws://127.0.0.1:4100/session" "$DUR"
count=$(ls "$OUT"/f-*.bin 2>/dev/null | wc -l)
echo "frames=$count"
echo "OUT=$OUT"
