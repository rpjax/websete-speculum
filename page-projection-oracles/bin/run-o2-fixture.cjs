#!/usr/bin/env node
'use strict';
const assert = require('node:assert');
const { compareTriple } = require('../o2-structural.cjs');

const a = { kind: 'element', tag: 'div', children: [{ kind: 'text', value: 'x' }] };
const b = { kind: 'element', tag: 'div', children: [{ kind: 'text', value: 'y' }] };
const result = compareTriple(a, a, b);
assert.strictEqual(result.pass, false, 'O2 drift MUST fail');
console.log('[oracle:o2-fixture] FAIL-as-expected (oracle correctly rejects)');
