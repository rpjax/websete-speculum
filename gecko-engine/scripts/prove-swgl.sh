#!/usr/bin/env bash
# B1: prova software WebRender + ausencia de GPU (log MOZ_LOG).
set -euo pipefail
ROOT="${SPECULUM_GECKO_ROOT:-$HOME/speculum-gecko}"
ENGINE="${SPECULUM_GECKO_ENGINE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PROFILE="${BASELINE_PROFILE:-$ENGINE/baseline-profile}"
LOG="$ROOT/baseline/swgl-proof.log"
mkdir -p "$ROOT/baseline"
export MOZ_HEADLESS=1 MOZ_HEADLESS_WIDTH=1280 MOZ_HEADLESS_HEIGHT=720
export MOZ_LOG="${MOZ_LOG:-RenderThread:5,Widget:5}"
cd "$ROOT/checkout"
{
  echo "=== profile=$PROFILE ==="
  grep -E "webrender.software|acceleration" "$PROFILE/user.js" || true
  timeout 45 ./mach run --headless -profile "$PROFILE" about:blank
} >"$LOG" 2>&1
echo "=== proof lines ==="
grep -E "RenderCompositorSWGL::RenderCompositorSWGL|UseSoftwareWebRender|Software WebRender|WEBGL_EXHAUSTED|layers.acceleration" "$LOG" || true
