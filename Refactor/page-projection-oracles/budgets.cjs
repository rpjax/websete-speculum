/**
 * Normative budgets from docs/page-projection-engine-redesign.md §2.
 * Starting defaults until O4 recalibrates E6/E7b/E11/pool knobs.
 */
'use strict'

/** @typedef {{ id: string, ok: boolean, measured?: number|string, target?: string, detail?: string }} GateResult */

const parity = Object.freeze({
  P1_fcpDeltaMs: { p50: 100, p95: 200 },
  P2_fullyMaterializedDeltaMs: { p95: 300 },
  P3_liveLagMs: { p50RttPlus: 20, p95RttPlus: 50 },
  P4_localFeedbackMs: 16,
  P5_authoritativeMsRttPlus: 50,
  P6_hardNavSwapMs: 150,
  P7_pixelDiffPct: 0.5,
  P7_structuralRegionViewportPct: 2,
})

const engine = Object.freeze({
  E1_cpuPctOfPage: 10,
  E1_absMsAt20k: 200,
  E2_establishWallMsAt20k: 150,
  E3_producerUsPerOp: 10,
  E4_clientUsPerOp: 10,
  E5_framePipelineUs: 100,
  E6_steadyStateCorePct: 0.3,
  E7_sessionMemMb: 16,
  E7_mirrorMb: 4,
  E7_l1Mb: 8,
  E7_overheadMb: 4,
  E7b_l2HostGiB: 1,
  E8_journalFactsPerLoad: 50,
  E9_clientApplyMs: 4,
  E10_bootCriticalPathMs: 50,
  E11_designSessions: 150,
  E11_gateSessions: 100,
})

module.exports = { parity, engine }
