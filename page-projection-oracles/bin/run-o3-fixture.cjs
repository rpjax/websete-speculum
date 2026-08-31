#!/usr/bin/env node
'use strict';
const assert = require('node:assert');
const { gateBudgets } = require('../o3-budgets.cjs');
const sample = require('../fixtures/current-engine-sample.cjs');

const result = gateBudgets(sample);
assert.strictEqual(result.pass, false, 'O3 current-engine sample MUST fail');
console.log('[oracle:o3-fixture] FAIL-as-expected', result.misses?.slice?.(0, 5) ?? result);
