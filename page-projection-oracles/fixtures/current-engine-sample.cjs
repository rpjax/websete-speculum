/**
 * Current-engine sample distilled from parityhop page-epoch story + redesign §2 Today column.
 * Oracles MUST fail this sample (WP1 exit).
 */
'use strict'

module.exports = {
  source: 'parityhop / redesign §2 Today',
  site: 'www.belezanaweb.com.br',
  establishWallMs: 6163,
  approxNodes: 23030,
  firstDiffTSinceCommitMs: 8680,
  bootMs: 3200,
  journalFactsPerLoad: 28324,
  projCpuPctOfPage: 300,
  projCpuAbsMs: 5924,
  // D6: no local-first
  localFeedbackMs: 220,
  authoritativeMs: 320,
  rttMs: 40,
  // O1: blank hero = structural region
  pixelDiffPct: 12.5,
  structuralRegions: 1,
  producerUsPerOp: 500,
  clientUsPerOp: 400,
  framePipelineUs: 5000,
  concurrentSessionsHoldingP: 0,
}
