#!/bin/bash
# A/B: headless vs headed — Beleza rows + probe-gfx (canvas/WebGL).
set -euo pipefail
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet

sed -i 's/\r$//' gecko-engine/devpath/lab-arm-capture.mjs \
  gecko-engine/devpath/_restart-lab-safe.sh \
  sidecar/browser/mirror/projection/lab/fixtures/probe-gfx.html

echo "== build Lab (HEADLESS pass-through) =="
/root/.dotnet/dotnet build gecko-engine/supervisor/src/Speculum.Lab/Speculum.Lab.csproj -c Release --nologo -v quiet

run_arm() {
  local arm="$1"   # headless|headed
  local headless_env="$2"  # 1|0
  local out="/tmp/ab-$arm"
  rm -rf "$out"
  mkdir -p "$out"
  echo "==== ARM $arm HEADLESS=$headless_env ===="
  export SPECULUM_BROWSER_HEADLESS="$headless_env"
  export MOZ_LOG=Speculum:5
  export MOZ_LOG_FILE="/tmp/speculum-moz-$arm.log"
  rm -f "$MOZ_LOG_FILE"
  bash gecko-engine/devpath/_restart-lab-safe.sh | tee "$out/restart.txt" | tail -3
  # confirm firefox args
  sleep 1
  ps -ww -o args= -C firefox 2>/dev/null | head -2 | tee "$out/firefox-args.txt" || true

  echo "-- probe-gfx --"
  OUT_DIR="$out/probe" WAIT_MS=12000 node gecko-engine/devpath/lab-arm-capture.mjs \
    'http://127.0.0.1:4077/fixtures/probe-gfx.html' 12000 \
    >"$out/probe.json" 2>"$out/probe.err" || true

  echo "-- beleza 50s --"
  # restart session clean between captures (lab may kill supervisor on stop)
  bash gecko-engine/devpath/_restart-lab-safe.sh >/dev/null
  OUT_DIR="$out/beleza" WAIT_MS=50000 node gecko-engine/devpath/lab-arm-capture.mjs \
    'https://www.belezanaweb.com.br/' 50000 \
    >"$out/beleza.json" 2>"$out/beleza.err" || true

  grep -E 'SWGL|framebuffer|WEBGL|GraphicsCritical' /tmp/speculum-lab.log 2>/dev/null | tail -5 \
    | tee "$out/gfx-log.txt" || true
  if [ -f "$MOZ_LOG_FILE" ]; then
    grep -Ei 'webgl|swgl|framebuffer|canvas|akam|error' "$MOZ_LOG_FILE" | tail -20 \
      | tee "$out/moz-gfx.txt" || true
  fi
}

run_arm headless 1
run_arm headed 0

python3 <<'PY'
import json, os
def load(p):
  try:
    return json.load(open(p))
  except Exception as e:
    return {"error": str(e)}

def summarize(arm):
  base=f'/tmp/ab-{arm}'
  probe=load(f'{base}/probe.json')
  beleza=load(f'{base}/beleza.json')
  args=''
  try: args=open(f'{base}/firefox-args.txt').read().strip()
  except: pass
  pr=probe.get('probe') or {}
  return {
    'arm': arm,
    'firefoxArgsHasHeadless': '--headless' in args,
    'firefoxArgs': args[:200],
    'probe': {
      'canvas2d': (pr.get('canvas2d') or {}),
      'webgl': {k:(pr.get('webgl') or {}).get(k) for k in ('ok','reason','renderer','vendor','readPixels','err')},
      'webgl2': {k:(pr.get('webgl2') or {}).get(k) for k in ('ok','reason','renderer')},
      'outerInner': pr.get('outerInner'),
      'webdriver': pr.get('webdriver'),
    } if pr else {'missing': True, 'probeErr': probe.get('error'), 'textMarkers': probe.get('textMarkers')},
    'beleza': {
      'maxTableSize': beleza.get('maxTableSize'),
      'lastDumpRows': beleza.get('lastDumpRows'),
      'binaryFrames': beleza.get('binaryFrames'),
      'navigated': beleza.get('navigated'),
      'textMarkers': beleza.get('textMarkers'),
      'frameEmitted': beleza.get('frameEmitted'),
    },
  }

rep={'headless': summarize('headless'), 'headed': summarize('headed')}
h=rep['headless']['beleza'].get('maxTableSize') or 0
d=rep['headed']['beleza'].get('maxTableSize') or 0
rep['verdict']={
  'headedBigger': d > h + 100,
  'headedStoreSized': d >= 5000,
  'headlessStoreSized': h >= 5000,
  'headlessStuckShell': h > 0 and h < 200,
  'headedStuckShell': d > 0 and d < 200,
  'oneLiner': (
    'HEADLESS stuck, HEADED store — falta ambiente headless/gfx'
    if (h < 200 and d >= 5000) else
    'ambos stuck — mais que gfx (rede/IP/fingerprint)'
    if (h < 200 and d < 200) else
    'ambos store — antibot flaky / já ok neste run'
    if (h >= 5000 and d >= 5000) else
    f'headless_rows={h} headed_rows={d}'
  ),
}
open('/tmp/ab-report.json','w').write(json.dumps(rep, indent=2))
print(json.dumps(rep, indent=2))
PY
