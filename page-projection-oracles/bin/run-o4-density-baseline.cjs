#!/usr/bin/env node
'use strict';
/**
 * O4 / PP-DEN-2 density baseline — writes artifacts/pp-den-2-baseline.json.
 * Uses the synthetic current-engine curve until a live N-session lab is available (WP14).
 */
const fs = require('node:fs');
const path = require('node:path');
const { currentEngineBaselineCurve, findKnee } = require('../o4-density.cjs');

const curve = currentEngineBaselineCurve();
const knee = findKnee(curve);
const out = {
  generatedAt: new Date().toISOString(),
  source: 'synthetic-current-engine',
  kneeSessionCount: knee.kneeSessions,
  knee,
  curve,
};
const dir = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'pp-den-2-baseline.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log('[oracle:density-baseline] wrote', file, 'kneeSessions=', knee.kneeSessions);
