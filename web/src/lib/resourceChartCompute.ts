import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

export interface ResourceSample {
  utc: string
  timestamp: number
  cpu: number
  memoryMb: number
  threads: number | null
}

export interface MetricDef {
  key: string
  label: string
  unit: string
  color: string
  fill: string
  extract: (s: ResourceSample) => number
}

export type TimePreset = '5m' | '15m' | '1h' | '6h' | '24h' | 'all' | 'custom'
export type Granularity = 'raw' | 'auto' | '1m' | '5m' | '15m' | '1h'
export type AggFn = 'avg' | 'max' | 'min' | 'last'
export type ScaleMode = 'absolute' | 'normalized' | 'indexed'

export interface PointInsight {
  index: number
  utc: string
  cpu: number
  memoryMb: number
  threads: number | null
  cpuDelta: number | null
  memoryDelta: number | null
  threadsDelta: number | null
  divergences: string[]
}

const PRESET_MS: Record<Exclude<TimePreset, 'custom' | 'all'>, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
}

const GRANULARITY_MS: Record<Exclude<Granularity, 'raw' | 'auto'>, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
}

export function filterByTimeRange(
  samples: ResourceSample[],
  preset: TimePreset,
  customFrom?: number | null,
  customTo?: number | null,
  now = Date.now(),
): ResourceSample[] {
  if (samples.length === 0) return []

  if (preset === 'custom') {
    const from = customFrom ?? samples[0].timestamp
    const to = customTo ?? now
    return samples.filter((s) => s.timestamp >= from && s.timestamp <= to)
  }

  if (preset === 'all') return samples

  const ms = PRESET_MS[preset]
  const cutoff = now - ms
  return samples.filter((s) => s.timestamp >= cutoff)
}

export function computeAutoBucketMs(samples: ResourceSample[]): number {
  if (samples.length < 2) return 60_000
  const range = samples[samples.length - 1].timestamp - samples[0].timestamp
  const targetBuckets = Math.min(40, Math.max(12, Math.round(samples.length / 2)))
  return Math.max(30_000, Math.round(range / targetBuckets))
}

export function parseGranularityMs(granularity: Granularity, samples: ResourceSample[]): number {
  if (granularity === 'raw') return 0
  if (granularity === 'auto') return computeAutoBucketMs(samples)
  return GRANULARITY_MS[granularity]
}

function aggregate(values: number[], fn: AggFn): number {
  if (values.length === 0) return 0
  switch (fn) {
    case 'min': return Math.min(...values)
    case 'max': return Math.max(...values)
    case 'last': return values[values.length - 1]
    default: return values.reduce((a, b) => a + b, 0) / values.length
  }
}

export function bucketResourceSamples(
  samples: ResourceSample[],
  granularity: Granularity,
  agg: AggFn,
): ResourceSample[] {
  if (samples.length === 0) return []
  if (granularity === 'raw' || samples.length < 2) return samples

  const bucketMs = parseGranularityMs(granularity, samples)
  const minT = samples[0].timestamp
  const buckets = new Map<number, ResourceSample[]>()

  for (const s of samples) {
    const bucketStart = minT + Math.floor((s.timestamp - minT) / bucketMs) * bucketMs
    const list = buckets.get(bucketStart) ?? []
    list.push(s)
    buckets.set(bucketStart, list)
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, items]) => ({
      utc: new Date(start + bucketMs / 2).toISOString(),
      timestamp: start + bucketMs / 2,
      cpu: Math.round(aggregate(items.map((i) => i.cpu), agg) * 10) / 10,
      memoryMb: Math.round(aggregate(items.map((i) => i.memoryMb), agg)),
      threads: (() => {
        const vals = items.map((i) => i.threads).filter((v): v is number => v != null)
        if (vals.length === 0) return null
        return Math.round(aggregate(vals, agg))
      })(),
    }))
}

export function scaleSeries(values: number[], mode: ScaleMode): { values: number[]; min: number; max: number; unit: string } {
  if (values.length === 0) return { values: [], min: 0, max: 1, unit: '' }

  if (mode === 'absolute') {
    const min = Math.min(0, ...values)
    const max = Math.max(...values) * 1.05 || 1
    return { values, min, max, unit: '' }
  }

  if (mode === 'normalized') {
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    return {
      values: values.map((v) => ((v - min) / range) * 100),
      min: 0,
      max: 100,
      unit: '%',
    }
  }

  const base = values[0] || 1
  const scaled = values.map((v) => ((v - base) / Math.abs(base)) * 100)
  const min = Math.min(...scaled, 0)
  const max = Math.max(...scaled, 0) * 1.1 || 1
  return { values: scaled, min, max, unit: '%Δ' }
}

export function analyzePoint(samples: ResourceSample[], index: number): PointInsight | null {
  if (index < 0 || index >= samples.length) return null
  const curr = samples[index]
  const prev = index > 0 ? samples[index - 1] : null

  const cpuDelta = prev ? curr.cpu - prev.cpu : null
  const memoryDelta = prev ? curr.memoryMb - prev.memoryMb : null
  const threadsDelta = prev && curr.threads != null && prev.threads != null ? curr.threads - prev.threads : null

  const divergences: string[] = []
  if (cpuDelta != null && memoryDelta != null) {
    if (cpuDelta <= -3 && memoryDelta >= 0) divergences.push('CPU fell while memory stayed flat or rose')
    if (cpuDelta >= 3 && memoryDelta <= -5) divergences.push('CPU rose while memory dropped')
    if (memoryDelta >= 25 && cpuDelta <= 1) divergences.push('Memory climbed without matching CPU load')
    if (cpuDelta >= 5 && memoryDelta <= 2) divergences.push('CPU spike with little memory movement')
    if (Math.abs(cpuDelta) >= 3 && Math.abs(memoryDelta) < 3) divergences.push('CPU moved independently of memory')
    if (Math.abs(memoryDelta) >= 15 && Math.abs(cpuDelta) < 2) divergences.push('Memory moved independently of CPU')
  }

  return {
    index,
    utc: curr.utc,
    cpu: curr.cpu,
    memoryMb: curr.memoryMb,
    threads: curr.threads,
    cpuDelta,
    memoryDelta,
    threadsDelta,
    divergences,
  }
}

export function computeStats(values: number[]) {
  if (values.length === 0) return { min: 0, max: 0, avg: 0, p95: 0, p99: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1],
    p99: sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1],
  }
}

export function nearestIndex(timestamps: number[], xRatio: number): number {
  if (timestamps.length === 0) return 0
  const target = Math.max(0, Math.min(1, xRatio))
  const t = timestamps[0] + target * (timestamps[timestamps.length - 1] - timestamps[0])
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < timestamps.length; i++) {
    const dist = Math.abs(timestamps[i] - t)
    if (dist < bestDist) { bestDist = dist; best = i }
  }
  return best
}

export function toDatetimeLocalValue(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function parseDatetimeLocalValue(value: string): number | null {
  if (!value) return null
  const ts = new Date(value).getTime()
  return Number.isNaN(ts) ? null : ts
}

/** Chart series backed by the composite telemetry sample's `host` section. */
export const METRICS: MetricDef[] = [
  { key: 'cpu', label: 'CPU', unit: '%', color: 'rgb(59,130,246)', fill: 'rgba(59,130,246,0.1)', extract: (s) => s.cpu },
  { key: 'memory', label: 'Memory', unit: ' MB', color: 'rgb(168,85,247)', fill: 'rgba(168,85,247,0.1)', extract: (s) => s.memoryMb },
  { key: 'threads', label: 'Threads', unit: '', color: 'rgb(34,197,94)', fill: 'rgba(34,197,94,0.1)', extract: (s) => s.threads ?? 0 },
]

/**
 * Projects `Telemetry.SampleCollected` events onto {@link ResourceSample}s from their `host`
 * section: bytes→MB, cpuUsage rounded to .1, thread count passed through. Events that are not
 * telemetry samples or that carry no `host` section are dropped; the result is ascending by time.
 */
export function telemetryToResourceSamples(events: DiagnosticsEventRecord[]): ResourceSample[] {
  return events
    .filter((e) => e.name === 'Telemetry.SampleCollected')
    .map((evt): ResourceSample | null => {
      const payload = evt.payload as Record<string, unknown> | null
      const host = (payload?.host ?? null) as Record<string, unknown> | null
      if (!host) return null
      const memBytes = typeof host.memoryUsed === 'number' ? (host.memoryUsed as number) : 0
      return {
        utc: evt.utc,
        timestamp: new Date(evt.utc).getTime(),
        cpu: typeof host.cpuUsage === 'number' ? Math.round((host.cpuUsage as number) * 10) / 10 : 0,
        memoryMb: memBytes > 0 ? Math.round(memBytes / (1024 * 1024)) : 0,
        threads: typeof host.threadCount === 'number' ? (host.threadCount as number) : null,
      }
    })
    .filter((s): s is ResourceSample => s !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
}
