'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { PNG } = require('pngjs')
const { compareStillPair } = require('../o1-visual.cjs')
const { compareTriple, compareChecksums } = require('../o2-structural.cjs')
const { gateBudgets } = require('../o3-budgets.cjs')
const { gateInteraction, currentEngineInteractionFixture } = require('../o5-interaction.cjs')
const { findKnee, currentEngineBaselineCurve, recordBaseline } = require('../o4-density.cjs')
const current = require('../fixtures/current-engine-sample.cjs')

function solidPng(w, h, rgb) {
  const png = new PNG({ width: w, height: h })
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    png.data[o] = rgb[0]
    png.data[o + 1] = rgb[1]
    png.data[o + 2] = rgb[2]
    png.data[o + 3] = 255
  }
  return PNG.sync.write(png)
}

function blankHeroPair() {
  // Virtual: white with a red hero band; Projected: all white (blank hero — BZ5)
  const w = 200
  const h = 100
  const virtual = new PNG({ width: w, height: h })
  const projected = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      virtual.data[i] = 255
      virtual.data[i + 1] = 255
      virtual.data[i + 2] = 255
      virtual.data[i + 3] = 255
      projected.data[i] = 255
      projected.data[i + 1] = 255
      projected.data[i + 2] = 255
      projected.data[i + 3] = 255
      if (y >= 20 && y < 60) {
        virtual.data[i] = 200
        virtual.data[i + 1] = 40
        virtual.data[i + 2] = 40
      }
    }
  }
  return { virtual: PNG.sync.write(virtual), projected: PNG.sync.write(projected) }
}

test('O3: current-engine sample MUST fail E2/E8/E1/E10/D1', () => {
  const { ok, results } = gateBudgets(current)
  assert.equal(ok, false, 'oracle that passes today is broken')
  const byId = Object.fromEntries(results.map((r) => [r.id, r]))
  assert.equal(byId.E2.ok, false)
  assert.equal(byId.E8.ok, false)
  assert.equal(byId['E1.pct'].ok, false)
  assert.equal(byId.E10.ok, false)
  assert.equal(byId['D1.firstDiff'].ok, false)
})

test('O1: blank-hero pair MUST fail P7 structural region', () => {
  const { virtual, projected } = blankHeroPair()
  const { ok, results, structuralRegions } = compareStillPair(virtual, projected)
  assert.equal(ok, false)
  assert.ok(structuralRegions >= 1)
  assert.ok(results.some((r) => r.id === 'P7.structuralRegions' && !r.ok))
})

test('O1: identical stills PASS P7', () => {
  const img = solidPng(40, 40, [10, 20, 30])
  const { ok } = compareStillPair(img, img)
  assert.equal(ok, true)
})

test('O2: isomorphic trees PASS; drift FAILS', () => {
  const tree = {
    kind: 'element',
    id: 1,
    tag: 'div',
    attrs: { class: 'a' },
    children: [{ kind: 'text', id: 2, value: 'hi' }],
  }
  assert.equal(compareTriple(tree, tree, tree).ok, true)
  const drift = {
    kind: 'element',
    id: 1,
    tag: 'div',
    attrs: { class: 'a' },
    children: [{ kind: 'text', id: 2, value: 'HOLE' }],
  }
  assert.equal(compareTriple(tree, tree, drift).ok, false)
})

test('O2 prod checksum mismatch FAILS', () => {
  assert.equal(compareChecksums(100, 'abc', 100, 'abc').ok, true)
  assert.equal(compareChecksums(100, 'abc', 99, 'abc').ok, false)
})

test('O5: current-engine / stalled network MUST fail P4 (D6)', () => {
  const { ok, results } = gateInteraction(currentEngineInteractionFixture())
  assert.equal(ok, false)
  assert.ok(results.some((r) => r.id === 'P4' && !r.ok))
})

test('O5: local-first with stalled network PASSES P4', () => {
  const { ok } = gateInteraction({
    localFeedbackMs: 8,
    authoritativeMs: 80,
    rttMs: 40,
    networkStalled: true,
  })
  assert.equal(ok, true)
})

test('O4/PP-DEN-2: current-engine baseline records a knee well below gate 100', () => {
  const curve = currentEngineBaselineCurve()
  const baseline = recordBaseline(curve)
  assert.equal(baseline.testId, 'PP-DEN-2')
  assert.equal(baseline.k3Claimed, false)
  assert.ok(baseline.knee.kneeSessions != null)
  assert.ok(baseline.knee.kneeSessions < 100)
  const knee = findKnee(curve)
  assert.equal(knee.kneeSessions, baseline.knee.kneeSessions)
})
