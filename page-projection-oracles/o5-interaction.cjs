/**
 * O5 — Interaction latency probe (redesign §7).
 * Asserts P4 (local ≤16ms, never network) and P5 (authoritative ≤ RTT+50).
 * With network stalled, local feedback must still hold P4.
 */
'use strict'

const { parity } = require('./budgets.cjs')

/**
 * @param {{ localFeedbackMs: number, authoritativeMs: number, rttMs: number, networkStalled?: boolean }} sample
 */
function gateInteraction(sample) {
  /** @type {import('./budgets.cjs').GateResult[]} */
  const results = []
  const p4 = sample.localFeedbackMs <= parity.P4_localFeedbackMs
  results.push({
    id: 'P4',
    ok: p4,
    measured: sample.localFeedbackMs,
    target: `≤ ${parity.P4_localFeedbackMs} ms`,
    detail: sample.networkStalled ? 'network stalled' : undefined,
  })
  if (sample.networkStalled && sample.localFeedbackMs > parity.P4_localFeedbackMs) {
    results.push({
      id: 'P4.networkIndependent',
      ok: false,
      detail: 'local feedback must not wait on network (D6)',
    })
  }
  const p5Limit = sample.rttMs + parity.P5_authoritativeMsRttPlus
  const p5 = sample.authoritativeMs <= p5Limit
  results.push({
    id: 'P5',
    ok: p5,
    measured: sample.authoritativeMs,
    target: `≤ ${p5Limit} (RTT ${sample.rttMs}+${parity.P5_authoritativeMsRttPlus})`,
  })
  return { ok: results.every((r) => r.ok), results }
}

/** Current-engine / D6 fixture: click path is network-bound (~200–350ms), no local-first. */
function currentEngineInteractionFixture() {
  return {
    localFeedbackMs: 220,
    authoritativeMs: 320,
    rttMs: 40,
    networkStalled: true,
  }
}

module.exports = { gateInteraction, currentEngineInteractionFixture }
