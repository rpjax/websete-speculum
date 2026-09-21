#!/bin/bash
set -euo pipefail
REPO='/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum'
cd "$REPO"

node --input-type=module <<'EOF'
import fs from 'fs';
import { peekFrameHeader } from './packages/page-projection/dist/core/decode.js';
const dir = '/tmp/beleza-diag-apply-1789532721572';
const files = fs.readdirSync(dir).filter((f) => /^f-\d+\.bin$/.test(f)).sort();
for (const f of files.slice(0, 8)) {
  const h = peekFrameHeader(new Uint8Array(fs.readFileSync(`${dir}/${f}`)));
  console.log(f, h && { gen: h.generation, seq: h.sequence, flags: h.flags, resync: !!(h.flags & 2) });
}
console.log('total', files.length);
EOF

# Rebuild replay bundle from current sources, then replay GOOD73 with note on gate
npx esbuild gecko-engine/devpath/replay-entry.ts \
  --bundle --format=iife --global-name=SpeculumReplay --platform=browser --target=es2022 \
  --outfile=gecko-engine/devpath/projected-replay.bundle.js >/tmp/esbuild-replay.txt 2>&1 || true
tail -5 /tmp/esbuild-replay.txt

bash gecko-engine/devpath/_restart-lab-safe.sh 2>&1 | tail -2
WAIT_MS=30000 node gecko-engine/devpath/lab-desync-probe.mjs 'https://example.com/' >/tmp/ex-desync.json 2>/tmp/ex-desync.err || true
python3 - <<'PY'
import json
d=json.load(open('/tmp/ex-desync.json'))
print('example_desync', d.get('summary'), {k:d.get('hud',{}).get(k) for k in ['frames','apply','desync','resync','bodyLen','build']})
PY
