/** Shared health score for Motor overview (and any non-Admin surface). */

export function computeHealthScore(metrics: {
  degraded: boolean
  eventsDropped: number
  overflowCount: number
  liveSessions: number
  storagePercent: number
  capabilitiesOff: number
  totalCapabilities: number
}): number {
  let score = 100
  if (metrics.degraded) score -= 40
  if (metrics.eventsDropped > 0) score -= Math.min(20, metrics.eventsDropped * 2)
  if (metrics.overflowCount > 0) score -= Math.min(15, metrics.overflowCount * 5)
  if (metrics.storagePercent > 90) score -= 15
  else if (metrics.storagePercent > 70) score -= 5
  if (metrics.capabilitiesOff > 0) score -= Math.min(15, metrics.capabilitiesOff * 3)
  return Math.max(0, Math.min(100, Math.round(score)))
}
