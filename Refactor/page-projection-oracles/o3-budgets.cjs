/**
 * O3 — Budget gate (redesign §7 / §2).
 * Any P1–P7 or E1–E11 miss fails. Fixture from current engine MUST fail (E2/E8/E1/P7…).
 */
'use strict'

const { parity, engine } = require('./budgets.cjs')

/**
 * @typedef {object} Sample
 * @property {number} [establishWallMs]
 * @property {number} [approxNodes]
 * @property {number} [journalFactsPerLoad]
 * @property {number} [bootMs]
 * @property {number} [projCpuPctOfPage]
 * @property {number} [projCpuAbsMs]
 * @property {number} [firstDiffTSinceCommitMs]
 * @property {number} [deltaFcpMs]
 * @property {number} [deltaFullyMs]
 * @property {number} [liveLagP50Ms]
 * @property {number} [liveLagP95Ms]
 * @property {number} [rttMs]
 * @property {number} [localFeedbackMs]
 * @property {number} [authoritativeMs]
 * @property {number} [hardNavSwapMs]
 * @property {number} [pixelDiffPct]
 * @property {number} [structuralRegions]
 * @property {number} [producerUsPerOp]
 * @property {number} [clientUsPerOp]
 * @property {number} [framePipelineUs]
 * @property {number} [steadyStateCorePct]
 * @property {number} [sessionMemMb]
 * @property {number} [l2HostGiB]
 * @property {number} [clientApplyMs]
 * @property {number} [concurrentSessionsHoldingP]
 */

/**
 * @param {Sample} s
 * @returns {{ ok: boolean, results: import('./budgets.cjs').GateResult[] }}
 */
function gateBudgets(s) {
  /** @type {import('./budgets.cjs').GateResult[]} */
  const results = []
  const push = (id, ok, measured, target, detail) => {
    results.push({ id, ok, measured, target, detail })
  }

  if (s.establishWallMs != null) {
    const nodes = s.approxNodes ?? 0
    // E2 is defined at 20k; scale only as informational — gate absolute when nodes≥15k
    const apply = nodes >= 15000 || nodes === 0
    const ok = !apply || s.establishWallMs <= engine.E2_establishWallMsAt20k
    push(
      'E2',
      ok,
      s.establishWallMs,
      `≤ ${engine.E2_establishWallMsAt20k} ms @~20k (nodes=${nodes})`,
    )
  }

  if (s.journalFactsPerLoad != null) {
    push(
      'E8',
      s.journalFactsPerLoad <= engine.E8_journalFactsPerLoad,
      s.journalFactsPerLoad,
      `≤ ${engine.E8_journalFactsPerLoad}`,
    )
  }

  if (s.bootMs != null) {
    push('E10', s.bootMs <= engine.E10_bootCriticalPathMs, s.bootMs, `≤ ${engine.E10_bootCriticalPathMs} ms`)
  }

  if (s.projCpuPctOfPage != null) {
    push('E1.pct', s.projCpuPctOfPage <= engine.E1_cpuPctOfPage, s.projCpuPctOfPage, `≤ ${engine.E1_cpuPctOfPage}%`)
  }
  if (s.projCpuAbsMs != null && (s.approxNodes ?? 0) >= 15000) {
    push('E1.abs', s.projCpuAbsMs <= engine.E1_absMsAt20k, s.projCpuAbsMs, `≤ ${engine.E1_absMsAt20k} ms`)
  }

  if (s.firstDiffTSinceCommitMs != null) {
    // Progressive paint / D1: first paint must not wait multi-second batch; use E2 as ceiling proxy for cold
    push(
      'D1.firstDiff',
      s.firstDiffTSinceCommitMs <= engine.E2_establishWallMsAt20k,
      s.firstDiffTSinceCommitMs,
      `≤ ${engine.E2_establishWallMsAt20k} ms (progressive; D1)`,
    )
  }

  if (s.deltaFcpMs != null) {
    push('P1', s.deltaFcpMs <= parity.P1_fcpDeltaMs.p95, s.deltaFcpMs, `p95 ≤ ${parity.P1_fcpDeltaMs.p95} ms`)
  }
  if (s.deltaFullyMs != null) {
    push('P2', s.deltaFullyMs <= parity.P2_fullyMaterializedDeltaMs.p95, s.deltaFullyMs, `p95 ≤ ${parity.P2_fullyMaterializedDeltaMs.p95} ms`)
  }
  if (s.liveLagP95Ms != null && s.rttMs != null) {
    push(
      'P3.p95',
      s.liveLagP95Ms <= s.rttMs + parity.P3_liveLagMs.p95RttPlus,
      s.liveLagP95Ms,
      `≤ RTT(${s.rttMs})+${parity.P3_liveLagMs.p95RttPlus}`,
    )
  }
  if (s.localFeedbackMs != null) {
    push('P4', s.localFeedbackMs <= parity.P4_localFeedbackMs, s.localFeedbackMs, `≤ ${parity.P4_localFeedbackMs} ms`)
  }
  if (s.authoritativeMs != null && s.rttMs != null) {
    push(
      'P5',
      s.authoritativeMs <= s.rttMs + parity.P5_authoritativeMsRttPlus,
      s.authoritativeMs,
      `≤ RTT+${parity.P5_authoritativeMsRttPlus}`,
    )
  }
  if (s.hardNavSwapMs != null) {
    push('P6', s.hardNavSwapMs <= parity.P6_hardNavSwapMs, s.hardNavSwapMs, `≤ ${parity.P6_hardNavSwapMs} ms`)
  }
  if (s.pixelDiffPct != null) {
    push('P7.pct', s.pixelDiffPct <= parity.P7_pixelDiffPct, s.pixelDiffPct, `≤ ${parity.P7_pixelDiffPct}%`)
  }
  if (s.structuralRegions != null) {
    push('P7.struct', s.structuralRegions === 0, s.structuralRegions, '0')
  }

  if (s.producerUsPerOp != null) {
    push('E3', s.producerUsPerOp <= engine.E3_producerUsPerOp, s.producerUsPerOp, `≤ ${engine.E3_producerUsPerOp} µs`)
  }
  if (s.clientUsPerOp != null) {
    push('E4', s.clientUsPerOp <= engine.E4_clientUsPerOp, s.clientUsPerOp, `≤ ${engine.E4_clientUsPerOp} µs`)
  }
  if (s.framePipelineUs != null) {
    push('E5', s.framePipelineUs <= engine.E5_framePipelineUs, s.framePipelineUs, `≤ ${engine.E5_framePipelineUs} µs`)
  }
  if (s.steadyStateCorePct != null) {
    push('E6', s.steadyStateCorePct <= engine.E6_steadyStateCorePct, s.steadyStateCorePct, `≤ ${engine.E6_steadyStateCorePct}%`)
  }
  if (s.sessionMemMb != null) {
    push('E7', s.sessionMemMb <= engine.E7_sessionMemMb, s.sessionMemMb, `≤ ${engine.E7_sessionMemMb} MB`)
  }
  if (s.l2HostGiB != null) {
    push('E7b', s.l2HostGiB <= engine.E7b_l2HostGiB, s.l2HostGiB, `≤ ${engine.E7b_l2HostGiB} GiB`)
  }
  if (s.clientApplyMs != null) {
    push('E9', s.clientApplyMs <= engine.E9_clientApplyMs, s.clientApplyMs, `≤ ${engine.E9_clientApplyMs} ms`)
  }
  if (s.concurrentSessionsHoldingP != null) {
    push(
      'E11',
      s.concurrentSessionsHoldingP >= engine.E11_gateSessions,
      s.concurrentSessionsHoldingP,
      `gate ≥ ${engine.E11_gateSessions} (design ${engine.E11_designSessions})`,
    )
  }

  return { ok: results.every((r) => r.ok), results }
}

/**
 * Extract a Sample from a page-epoch story (current-engine shape).
 * @param {object} story
 */
function sampleFromPageEpochStory(story) {
  const epId = story.epochOrder?.[0]
  const ep = epId ? story.epochs?.[epId] : null
  if (!ep) return {}
  const domMapMs = ep.establish?.domMap?.completed?.durationMs
  const nodes = ep.establish?.domMap?.completed?.approxNodes
  const firstDiff = ep.establish?.firstDiffEmitted?.tSinceCommitMs
  const bootMs = ep.virtual?.bootMarked?.bootMs
  const facts =
    ep.diff?.journalFactCount ??
    ep.timings?.journalFactsPerLoad ??
    story.globals?.journalFactsPerLoad ??
    null

  // Current engine: DomMap duration ≈ establish wall (E2); ~300% CPU documented
  return {
    establishWallMs: domMapMs ?? ep.establish?.completed?.totalMs,
    approxNodes: nodes,
    firstDiffTSinceCommitMs: firstDiff,
    bootMs,
    journalFactsPerLoad: facts ?? estimateFactsFromDiff(ep),
    // Documented ~300% until measured — use redesign "Today" column when absent
    projCpuPctOfPage: ep.timings?.projCpuPctOfPage ?? 300,
    projCpuAbsMs: domMapMs,
  }
}

function estimateFactsFromDiff(ep) {
  // Current engine emits ~4 journal facts per op; envelope counts in story if present
  const envelopes = ep.diff?.envelopeCount ?? ep.diff?.frameCount ?? null
  if (envelopes != null) return envelopes * 4
  // Redesign "Today" ~28324 for a cold load
  return 28324
}

module.exports = { gateBudgets, sampleFromPageEpochStory, parity, engine }
