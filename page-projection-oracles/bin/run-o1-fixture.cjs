#!/usr/bin/env node
'use strict';
/**
 * Fixture gate: O1 must FAIL blank-hero (current-engine evidence). Exit 0 = oracle correctly rejects.
 */
const assert = require('node:assert');
const { compareStillPair } = require('../o1-visual.cjs');

async function main() {
  // Minimal 2x2 RGBA stills: left blank white, right has a dark block (structural miss).
  const { PNG } = require('pngjs');
  const blank = new PNG({ width: 64, height: 64 });
  blank.data.fill(255);
  const hero = new PNG({ width: 64, height: 64 });
  hero.data.fill(255);
  for (let y = 8; y < 40; y++) {
    for (let x = 8; x < 56; x++) {
      const i = (y * 64 + x) * 4;
      hero.data[i] = 20;
      hero.data[i + 1] = 20;
      hero.data[i + 2] = 20;
    }
  }
  const result = await compareStillPair(PNG.sync.write(blank), PNG.sync.write(hero));
  assert.strictEqual(result.pass, false, 'O1 blank-hero MUST fail');
  console.log('[oracle:o1-fixture] FAIL-as-expected (oracle correctly rejects)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
