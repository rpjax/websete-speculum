#!/bin/bash
# Beleza + WebGL normal (headed) — comparar tableSize vs shell Akamai (~54).
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin:/usr/sbin
export DOTNET_ROOT=/root/.dotnet
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"

sed -i 's/\r$//' gecko-engine/devpath/profiles/webgl-normal/user.js \
  gecko-engine/devpath/lab-arm-capture.mjs \
  gecko-engine/devpath/_restart-lab-safe.sh || true

/root/.dotnet/dotnet build gecko-engine/supervisor/src/Speculum.Lab/Speculum.Lab.csproj -c Release --nologo -v quiet
/root/.dotnet/dotnet build gecko-engine/supervisor/src/Speculum.Supervisor/Speculum.Supervisor.csproj -c Release --nologo -v quiet

PROFILE=/tmp/speculum-profile-webgl-beleza
rm -rf "$PROFILE"
mkdir -p "$PROFILE"
cp -f gecko-engine/devpath/profiles/webgl-normal/user.js "$PROFILE/user.js"

export SPECULUM_BROWSER_PROFILE="$PROFILE"
export SPECULUM_BROWSER_HEADLESS=0
export DISPLAY="${DISPLAY:-:0}"
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-0}"
export MOZ_LOG=Speculum:5
export MOZ_LOG_FILE=/tmp/speculum-moz-beleza-webgl.log
rm -f "$MOZ_LOG_FILE"

OUT=/tmp/beleza-webgl
rm -rf "$OUT"
mkdir -p "$OUT"

echo "PROFILE=$PROFILE HEADLESS=$SPECULUM_BROWSER_HEADLESS"
bash gecko-engine/devpath/_restart-lab-safe.sh | tee "$OUT/restart.txt" | tail -5

# Confirma WebGL no mesmo perfil/processo
PROBE="file://${REPO}/sidecar/browser/mirror/projection/lab/fixtures/probe-gfx.html"
echo "-- probe-gfx --"
OUT_DIR="$OUT/probe" WAIT_MS=12000 \
  node gecko-engine/devpath/lab-arm-capture.mjs "$PROBE" 12000 \
  >"$OUT/probe.json" 2>"$OUT/probe.err" || true

# Beleza 60s
bash gecko-engine/devpath/_restart-lab-safe.sh >/dev/null
echo "-- beleza 60s --"
OUT_DIR="$OUT/beleza" WAIT_MS=60000 \
  node gecko-engine/devpath/lab-arm-capture.mjs 'https://www.belezanaweb.com.br/' 60000 \
  >"$OUT/beleza.json" 2>"$OUT/beleza.err" || true

# Profile seed check
echo "-- user.js (product+webgl) --"
head -40 "$PROFILE/user.js" | tee "$OUT/user.js.head"

python3 <<'PY'
import json
def load(p):
  try: return json.load(open(p))
  except Exception as e: return {"error": str(e)}

probe=load('/tmp/beleza-webgl/probe.json')
beleza=load('/tmp/beleza-webgl/beleza.json')
pr=probe.get('probe') or {}
wg=pr.get('webgl') or {}
rows=beleza.get('maxTableSize')
dumps=beleza.get('dumps') or []
last=dumps[-1] if dumps else {}
fe=beleza.get('frameEmitted') or []
fe_last=fe[-1] if fe else {}
verdict='UNKNOWN'
if isinstance(rows, int):
  if rows <= 80: verdict='AKAMAI_SHELL_LIKELY'
  elif rows >= 1000: verdict='STORE_OR_CHALLENGE_PASSED'
  else: verdict='MID_GROWTH'

out={
  'webgl': {'ok': wg.get('ok'), 'renderer': wg.get('renderer'), 'vendor': wg.get('vendor')},
  'webgl2_ok': (pr.get('webgl2') or {}).get('ok'),
  'canvas2d_ok': (pr.get('canvas2d') or {}).get('ok'),
  'beleza': {
    'maxTableSize': rows,
    'lastDumpRows': last.get('rowCount'),
    'lastDumpSeq': last.get('sequence'),
    'lastFeTableSize': fe_last.get('tableSize'),
    'navigated': beleza.get('navigated'),
    'binaryFrames': beleza.get('binary'),
    'verdict': verdict,
    'baselineWas': 54,
  },
}
print('=== BELEZA × WEBGL ===')
print(json.dumps(out, indent=2))
open('/tmp/beleza-webgl/summary.json','w').write(json.dumps(out, indent=2)+'\n')
PY
