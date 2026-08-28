#!/bin/bash
# QA battery — Extension Plane (units + controlled fixture establish).
# From sidecar/:
#   docker compose -f docker-compose.lab.yml run --rm --no-deps \
#     -v "$PWD/browser:/app/browser" \
#     -v "$PWD/extensions:/app/extensions" \
#     -v "$PWD/scripts:/app/scripts" \
#     -v "$PWD/lab-runs:/app/lab-runs" \
#     -v "$PWD/unit.ts:/app/unit.ts" \
#     -v "$PWD/../packages/page-projection:/packages/page-projection" \
#     lab bash scripts/scratch/diag/qa-extension-plane.sh
set -euo pipefail
cd /packages/page-projection && npm run build
cd /app
npm run build:virtual
npx tsc --pretty false

echo '=== units: extension plane + loopback + chrome args ==='
node -e "
const { runExtensionPlaneEnvelopeUnitTests } = require('./dist/browser/mirror/projection/session/extensionPlaneEnvelope.unit.js');
const { runExtensionPlaneBridgeEdgeUnitTests } = require('./dist/browser/mirror/projection/session/extensionPlaneBridge.unit.js');
const { runLoopbackDataPlaneUnitTests } = require('./dist/browser/mirror/projection/session/loopbackDataPlane.unit.js');
const { runChromeLnaPolicyUnitTests } = require('./dist/browser/patchright/chromeLnaPolicy.unit.js');
(async () => {
  runExtensionPlaneEnvelopeUnitTests();
  await runExtensionPlaneBridgeEdgeUnitTests();
  await runLoopbackDataPlaneUnitTests();
  runChromeLnaPolicyUnitTests();
  console.log('[qa] extension-plane units ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
"

echo '=== lab: controlled fixture establish ==='
node scripts/scratch/diag/diag-extension-plane.js

echo '=== qa-extension-plane DONE ==='
