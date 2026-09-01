import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

export interface BucketInfo {
  start: number
  end: number
  count: number
  errors: number
  warnings: number
}

export interface BucketData {
  buckets: BucketInfo[]
  max: number
  minTime: number
  maxTime: number
}

export interface DomainBucket {
  domain: string
  counts: number[]
}

export interface DomainBucketData {
  domains: DomainBucket[]
  bucketStarts: number[]
  bucketEnds: number[]
  max: number
  maxStacked: number
}

export interface CumulativeData {
  times: number[]
  totals: number[]
}

export type TimeRange = '15m' | '1h' | '6h' | '24h' | 'all'
export type BucketSize = 'auto' | '1m' | '5m' | '15m' | '1h'
export type ChartMode = 'histogram' | 'heatmap' | 'stacked' | 'cumulative' | 'spans'

export function parseTimeRange(range: TimeRange): number {
  const map: Record<string, number> = { '15m': 15 * 60_000, '1h': 3600_000, '6h': 6 * 3600_000, '24h': 86400_000 }
  return map[range] ?? 3600_000
}

export function parseBucketSize(size: BucketSize): number {
  const map: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3600_000 }
  return map[size] ?? 300_000
}

export function computeBucketCount(events: DiagnosticsEventRecord[], bucketSize: BucketSize): number {
  if (bucketSize === 'auto') return Math.min(Math.max(Math.round(events.length / 3), 15), 60)
  const ms = parseBucketSize(bucketSize)
  if (events.length < 2) return 20
  const times = events.map((e) => new Date(e.utc).getTime())
  const range = Math.max(...times) - Math.min(...times)
  return Math.max(5, Math.min(100, Math.round(range / ms)))
}

export function computeBuckets(events: DiagnosticsEventRecord[], buckets: number): BucketData {
  if (events.length === 0) return { buckets: [], max: 0, minTime: Date.now(), maxTime: Date.now() }
  const times = events.map((e) => new Date(e.utc).getTime())
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)
  const range = maxTime - minTime || 1
  const step = range / buckets

  const result: BucketInfo[] = Array.from({ length: buckets }, (_, i) => ({
    start: minTime + i * step,
    end: minTime + (i + 1) * step,
    count: 0, errors: 0, warnings: 0,
  }))

  for (const evt of events) {
    const t = new Date(evt.utc).getTime()
    const idx = Math.min(Math.floor(((t - minTime) / range) * buckets), buckets - 1)
    result[idx].count++
    if (evt.severity === 'Error') result[idx].errors++
    if (evt.severity === 'Warning') result[idx].warnings++
  }

  return { buckets: result, max: Math.max(...result.map((b) => b.count)), minTime, maxTime }
}

export function computeDomainBuckets(events: DiagnosticsEventRecord[], bucketCount: number): DomainBucketData {
  if (events.length === 0) return { domains: [], bucketStarts: [], bucketEnds: [], max: 0, maxStacked: 0 }
  const times = events.map((e) => new Date(e.utc).getTime())
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)
  const range = maxTime - minTime || 1
  const step = range / bucketCount

  const domainSet = [...new Set(events.map((e) => e.domain))]
  const domainCounts = Object.fromEntries(domainSet.map((d) => [d, new Array(bucketCount).fill(0) as number[]]))

  for (const evt of events) {
    const t = new Date(evt.utc).getTime()
    const idx = Math.min(Math.floor(((t - minTime) / range) * bucketCount), bucketCount - 1)
    domainCounts[evt.domain][idx]++
  }

  const domains = domainSet.map((domain) => ({ domain, counts: domainCounts[domain] }))
  const bucketStarts = Array.from({ length: bucketCount }, (_, i) => minTime + i * step)
  const bucketEnds = Array.from({ length: bucketCount }, (_, i) => minTime + (i + 1) * step)
  const max = Math.max(...domains.flatMap((d) => d.counts), 1)
  const maxStacked = Math.max(...bucketStarts.map((_, i) => domains.reduce((sum, d) => sum + d.counts[i], 0)), 1)

  return { domains, bucketStarts, bucketEnds, max, maxStacked }
}

export function computeCumulative(events: DiagnosticsEventRecord[], points: number): CumulativeData {
  if (events.length === 0) return { times: [], totals: [] }
  const sorted = [...events].sort((a, b) => new Date(a.utc).getTime() - new Date(b.utc).getTime())
  const times = sorted.map((e) => new Date(e.utc).getTime())
  const minTime = times[0]
  const maxTime = times[times.length - 1]
  const range = maxTime - minTime || 1
  const step = range / points

  const result: number[] = []
  const resultTimes: number[] = []
  let cumulative = 0
  let eventIdx = 0

  for (let i = 0; i < points; i++) {
    const bucketEnd = minTime + (i + 1) * step
    while (eventIdx < times.length && times[eventIdx] <= bucketEnd) {
      cumulative++
      eventIdx++
    }
    resultTimes.push(minTime + (i + 0.5) * step)
    result.push(cumulative)
  }

  return { times: resultTimes, totals: result }
}
