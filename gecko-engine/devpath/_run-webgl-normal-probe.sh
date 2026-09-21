#!/bin/bash
# Habilita WebGL "normal" (prefs hardware) e roda probe-gfx.
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin:/usr/sbin
export DOTNET_ROOT=/root/.dotnet
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"

sed -i 's/\r$//' gecko-engine/devpath/profiles/webgl-normal/user.js gecko-engine/devpath/_run-webgl-normal-probe.sh || true
/root/.dotnet/dotnet build gecko-engine/supervisor/src/Speculum.Lab/Speculum.Lab.csproj -c Release --nologo -v quiet

PROFILE=/tmp/speculum-profile-webgl-normal
rm -rf "$PROFILE"
mkdir -p "$PROFILE"
cp -f gecko-engine/devpath/profiles/webgl-normal/user.js "$PROFILE/user.js"

export SPECULUM_BROWSER_PROFILE="$PROFILE"
export SPECULUM_BROWSER_HEADLESS="${SPECULUM_BROWSER_HEADLESS:-0}"
export MOZ_LOG="${MOZ_LOG:-Speculum:5,WebGL:5}"
export MOZ_LOG_FILE=/tmp/speculum-moz-webgl-normal.log
rm -f "$MOZ_LOG_FILE"

export DISPLAY="${DISPLAY:-:0}"
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-0}"

echo "PROFILE=$PROFILE HEADLESS=$SPECULUM_BROWSER_HEADLESS LIBGL_ALWAYS_SOFTWARE=$LIBGL_ALWAYS_SOFTWARE"
cat "$PROFILE/user.js"
bash gecko-engine/devpath/_restart-lab-safe.sh | tail -3

PROBE="file://${REPO}/sidecar/browser/mirror/projection/lab/fixtures/probe-gfx.html"
OUT_DIR=/tmp/webgl-normal-probe WAIT_MS=15000 \
  node gecko-engine/devpath/lab-arm-capture.mjs "$PROBE" 15000 \
  >/tmp/webgl-normal-probe.json 2>/tmp/webgl-normal-probe.err || true

python3 <<'PY'
import json
d=json.load(open('/tmp/webgl-normal-probe.json'))
p=d.get('probe') or {}
print('=== PROBE ===')
print(json.dumps({
  'canvas2d': p.get('canvas2d'),
  'webgl': p.get('webgl'),
  'webgl2': p.get('webgl2'),
  'outerInner': p.get('outerInner'),
}, indent=2))
print('nav', d.get('navigated'))
print('maxRows', d.get('maxTableSize'))
PY

echo '=== MOZ webgl lines ==='
grep -Ei 'webgl|WebGL|EGL|GLX|exhausted|denied|fail' "$MOZ_LOG_FILE" 2>/dev/null | tail -40 || true
