#!/usr/bin/env node
'use strict';
const assert = require('node:assert');
const { gateInteraction } = require('../o5-interaction.cjs');

const stalled = gateInteraction({ localPaintMs: 80, networkRttMs: 200, authoritativeDiffMs: 500 });
assert.strictEqual(stalled.pass, false, 'O5 stalled current-engine MUST fail P4');
console.log('[oracle:o5-fixture] FAIL-as-expected (oracle correctly rejects)');
