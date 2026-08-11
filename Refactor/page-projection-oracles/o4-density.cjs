/**
 * O4 — Density harness baseline (WP2 / PP-DEN-2).
 * Records knee curve: session count vs P1–P6 p50/p95 + host CPU/mem + rate degradation.
 * K3 is NOT claimed from baseline of current engine.
 */
'use strict'

const { engine } = require('./budgets.cjs')

/**
 * @typedef {{ sessions: number, p1P95Ms: number, p2P95Ms: number, p3P95Ms: number, p4P95Ms: number, p5P95Ms: number, p6P95Ms: number, hostCpuPct: number, hostMemGiB: number, rateHz: number }} DensityPoint
 */

/**
 * Find knee: first session count where any P1–P6 p95 exceeds budget or rate collapses.
 * @param {DensityPoint[]} curve
 */
function findKnee(curve) {
  const sorted = [...curve].sort((a, b) => a.sessions - b.sessions)
  for (const pt of sorted) {
    const degraded =
      pt.p1P95Ms > 200 ||
      pt.p2P95Ms > 300 ||
      pt.rateHz < 15 ||
      pt.hostCpuPct > 95
    if (degraded) {
      return { kneeSessions: pt.sessions, point: pt, reason: explain(pt) }
    }
  }
  return { kneeSessions: null, point: sorted[sorted.length - 1] || null, reason: 'no knee in sampled range' }
}

function explain(pt) {
  const reasons = []
  if (pt.p1P95Ms > 200) reasons.push(`P1 p95=${pt.p1P95Ms}`)
  if (pt.p2P95Ms > 300) reasons.push(`P2 p95=${pt.p2P95Ms}`)
  if (pt.rateHz < 15) reasons.push(`rateHz=${pt.rateHz}`)
  if (pt.hostCpuPct > 95) reasons.push(`cpu=${pt.hostCpuPct}%`)
  return reasons.join(', ')
}

/**
 * Current-engine synthetic baseline (unmeasured E11 — positive feedback under load).
 * Documented collapse under N sessions from BZ1 / redesign §3 D2.
 */
function currentEngineBaselineCurve() {
  return [
    { sessions: 1, p1P95Ms: 8700, p2P95Ms: 12000, p3P95Ms: 80, p4P95Ms: 250, p5P95Ms: 350, p6P95Ms: 2000, hostCpuPct: 40, hostMemGiB: 2, rateHz: 60 },
    { sessions: 10, p1P95Ms: 12000, p2P95Ms: 18000, p3P95Ms: 200, p4P95Ms: 400, p5P95Ms: 600, p6P95Ms: 3000, hostCpuPct: 85, hostMemGiB: 8, rateHz: 30 },
    { sessions: 25, p1P95Ms: 20000, p2P95Ms: 30000, p3P95Ms: 800, p4P95Ms: 800, p5P95Ms: 1200, p6P95Ms: 5000, hostCpuPct: 98, hostMemGiB: 16, rateHz: 5 },
    { sessions: 50, p1P95Ms: 40000, p2P95Ms: 60000, p3P95Ms: 2000, p4P95Ms: 1500, p5P95Ms: 2500, p6P95Ms: 8000, hostCpuPct: 100, hostMemGiB: 28, rateHz: 1 },
  ]
}

function recordBaseline(curve, meta = {}) {
  const knee = findKnee(curve)
  return {
    version: 1,
    recordedAt: new Date().toISOString(),
    testId: 'PP-DEN-2',
    engine: 'current',
    designSessions: engine.E11_designSessions,
    gateSessions: engine.E11_gateSessions,
    k3Claimed: false,
    curve,
    knee,
    ...meta,
  }
}

module.exports = { findKnee, currentEngineBaselineCurve, recordBaseline, engine }
