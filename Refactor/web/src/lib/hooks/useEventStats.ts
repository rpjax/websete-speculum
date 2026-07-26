import { useMemo } from 'react'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { DOMAIN_LABELS } from '@/lib/diagnosticsConstants'

export interface EventStats {
  total: number
  byDomain: Record<string, number>
  bySeverity: Record<string, number>
  byName: Record<string, number>
  errorCount: number
  warningCount: number
  uniqueConnections: number
  uniqueCorrelations: number
  eventRate: number
  timeSpanMs: number
  topEvents: { name: string; count: number }[]
  topDomains: { domain: string; label: string; count: number }[]
  severityDistribution: { severity: string; count: number; pct: number }[]
  rateOverTime: number[]
}

export function useEventStats(events: DiagnosticsEventRecord[]): EventStats {
  return useMemo(() => computeEventStats(events), [events])
}

export function computeEventStats(events: DiagnosticsEventRecord[]): EventStats {
  const byDomain: Record<string, number> = {}
  const bySeverity: Record<string, number> = {}
  const byName: Record<string, number> = {}
  const connections = new Set<string>()
  const correlations = new Set<string>()

  for (const evt of events) {
    byDomain[evt.domain] = (byDomain[evt.domain] ?? 0) + 1
    bySeverity[evt.severity] = (bySeverity[evt.severity] ?? 0) + 1
    byName[evt.name] = (byName[evt.name] ?? 0) + 1
    if (evt.connectionId) connections.add(evt.connectionId)
    if (evt.correlationId) correlations.add(evt.correlationId)
  }

  const times = events.map((e) => new Date(e.utc).getTime()).sort((a, b) => a - b)
  const timeSpanMs = times.length > 1 ? times[times.length - 1] - times[0] : 0
  const eventRate = timeSpanMs > 0 ? (events.length / timeSpanMs) * 60_000 : 0

  const rateOverTime = computeRateOverTime(events, 12)

  const topEvents = Object.entries(byName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  const topDomains = Object.entries(byDomain)
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => ({ domain, label: DOMAIN_LABELS[domain] ?? domain, count }))

  const severityDistribution = ['Info', 'Warning', 'Error', 'Metric']
    .filter((s) => bySeverity[s])
    .map((severity) => ({
      severity,
      count: bySeverity[severity],
      pct: Math.round((bySeverity[severity] / events.length) * 100),
    }))

  return {
    total: events.length,
    byDomain,
    bySeverity,
    byName,
    errorCount: bySeverity['Error'] ?? 0,
    warningCount: bySeverity['Warning'] ?? 0,
    uniqueConnections: connections.size,
    uniqueCorrelations: correlations.size,
    eventRate: Math.round(eventRate * 10) / 10,
    timeSpanMs,
    topEvents,
    topDomains,
    severityDistribution,
    rateOverTime,
  }
}

function computeRateOverTime(events: DiagnosticsEventRecord[], buckets: number): number[] {
  if (events.length < 2) return [events.length]
  const times = events.map((e) => new Date(e.utc).getTime())
  const min = Math.min(...times)
  const max = Math.max(...times)
  const range = max - min || 1
  const counts = new Array(buckets).fill(0) as number[]
  for (const t of times) {
    const idx = Math.min(Math.floor(((t - min) / range) * buckets), buckets - 1)
    counts[idx]++
  }
  return counts
}
