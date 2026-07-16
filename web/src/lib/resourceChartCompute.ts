import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

export interface ResourceSample {
  utc: string
  timestamp: number
  /**
   * Machine CPU % mirror of `values['host.cpu']` only — never filled from apiProcess.
   * Null when the host section did not contribute a reading.
   */
  cpu: number | null
  /**
   * Machine memory MB mirror of `values['host.memory']` only — never filled from apiProcess.
   * Null when the host section did not contribute a reading.
   */
  memoryMb: number | null
  /** API-process thread count mirror of `values['apiProcess.threads']` only. */
  threads: number | null
  /**
   * Flattened metric map keyed by catalog metric key (e.g. 'host.cpu', 'motor.live',
   * 'derived.cpuPerSession'). A metric whose section was not collected is absent/null.
   */
  values?: Record<string, number | null>
}

export type MetricSectionKey = 'host' | 'apiProcess' | 'motor' | 'sidecar' | 'persistence' | 'pipeline' | 'derived'

export interface MetricDef {
  key: string
  label: string
  unit: string
  color: string
  fill: string
  extract: (s: ResourceSample) => number | null
  /** Catalog section this metric belongs to (optional for legacy host-only defs). */
  section?: MetricSectionKey
  /** One-line operator explanation for tooltips / pickers. */
  description?: string
  /** Preferred default aggregation when bucketing (defaults to 'avg'). */
  defaultAgg?: AggFn
}

export type TimePreset = '5m' | '15m' | '1h' | '6h' | '24h' | 'all' | 'custom'
export type Granularity = 'raw' | 'auto' | '1m' | '5m' | '15m' | '1h'
export type AggFn = 'avg' | 'max' | 'min' | 'last'
export type ScaleMode = 'absolute' | 'normalized' | 'indexed'

export interface PointInsight {
  index: number
  utc: string
  cpu: number | null
  memoryMb: number | null
  threads: number | null
  cpuDelta: number | null
  memoryDelta: number | null
  threadsDelta: number | null
  /** Live motor sessions at this point (null when the motor section is absent). */
  liveSessions: number | null
  liveDelta: number | null
  /** CPU cost attributable to each live session (%/session), null when idle. */
  cpuPerSession: number | null
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
    .map(([start, items]) => {
      const cpus = items.map((i) => i.cpu).filter((v): v is number => v != null)
      const mems = items.map((i) => i.memoryMb).filter((v): v is number => v != null)
      const thr = items.map((i) => i.threads).filter((v): v is number => v != null)
      return {
        utc: new Date(start + bucketMs / 2).toISOString(),
        timestamp: start + bucketMs / 2,
        cpu: cpus.length === 0 ? null : Math.round(aggregate(cpus, agg) * 10) / 10,
        memoryMb: mems.length === 0 ? null : Math.round(aggregate(mems, agg)),
        threads: thr.length === 0 ? null : Math.round(aggregate(thr, agg)),
        values: aggregateValues(items, agg),
      }
    })
}

/** Aggregates every metric key seen across the bucket's samples, preserving nulls-only as null. */
function aggregateValues(items: ResourceSample[], agg: AggFn): Record<string, number | null> {
  const keys = new Set<string>()
  for (const it of items) if (it.values) for (const k of Object.keys(it.values)) keys.add(k)
  const out: Record<string, number | null> = {}
  for (const k of keys) {
    const vals = items
      .map((i) => i.values?.[k])
      .filter((v): v is number => typeof v === 'number')
    out[k] = vals.length === 0 ? null : Math.round(aggregate(vals, agg) * 100) / 100
  }
  return out
}

export function scaleSeries(
  values: (number | null)[],
  mode: ScaleMode,
): { values: (number | null)[]; min: number; max: number; unit: string } {
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (finite.length === 0) return { values: values.map(() => null), min: 0, max: 1, unit: '' }

  if (mode === 'absolute') {
    const min = Math.min(0, ...finite)
    const max = Math.max(...finite) * 1.05 || 1
    return { values, min, max, unit: '' }
  }

  if (mode === 'normalized') {
    const min = Math.min(...finite)
    const max = Math.max(...finite)
    const range = max - min || 1
    return {
      values: values.map((v) => (v == null ? null : ((v - min) / range) * 100)),
      min: 0,
      max: 100,
      unit: '%',
    }
  }

  const base = finite[0] || 1
  const scaled = values.map((v) => (v == null ? null : ((v - base) / Math.abs(base)) * 100))
  const finiteScaled = scaled.filter((v): v is number => v != null)
  const min = Math.min(...finiteScaled, 0)
  const max = Math.max(...finiteScaled, 0) * 1.1 || 1
  return { values: scaled, min, max, unit: '%Δ' }
}

function liveOf(s: ResourceSample): number | null {
  const v = s.values?.['motor.live']
  return typeof v === 'number' ? v : null
}

export function analyzePoint(samples: ResourceSample[], index: number): PointInsight | null {
  if (index < 0 || index >= samples.length) return null
  const curr = samples[index]
  const prev = index > 0 ? samples[index - 1] : null

  const cpuDelta = prev && curr.cpu != null && prev.cpu != null ? curr.cpu - prev.cpu : null
  const memoryDelta = prev && curr.memoryMb != null && prev.memoryMb != null ? curr.memoryMb - prev.memoryMb : null
  const threadsDelta = prev && curr.threads != null && prev.threads != null ? curr.threads - prev.threads : null

  const live = liveOf(curr)
  const prevLive = prev ? liveOf(prev) : null
  const liveDelta = live != null && prevLive != null ? live - prevLive : null
  const cpuPerSession = live != null && live > 0 && curr.cpu != null ? Math.round((curr.cpu / live) * 100) / 100 : null
  const prevCps = prev && prevLive != null && prevLive > 0 && prev.cpu != null ? prev.cpu / prevLive : null

  const divergences: string[] = []
  if (cpuDelta != null && memoryDelta != null) {
    if (cpuDelta <= -3 && memoryDelta >= 0) divergences.push('CPU fell while memory stayed flat or rose')
    if (cpuDelta >= 3 && memoryDelta <= -5) divergences.push('CPU rose while memory dropped')
    if (memoryDelta >= 25 && cpuDelta <= 1) divergences.push('Memory climbed without matching CPU load')
    if (cpuDelta >= 5 && memoryDelta <= 2) divergences.push('CPU spike with little memory movement')
    if (Math.abs(cpuDelta) >= 3 && Math.abs(memoryDelta) < 3) divergences.push('CPU moved independently of memory')
    if (Math.abs(memoryDelta) >= 15 && Math.abs(cpuDelta) < 2) divergences.push('Memory moved independently of CPU')
  }

  // Session-aware (nonlinear scaling) divergences — optional overlay context when motor is enabled.
  if (cpuDelta != null && liveDelta != null) {
    if (cpuDelta >= 4 && Math.abs(liveDelta) <= 1)
      divergences.push('CPU rose while live sessions stayed flat')
    if (memoryDelta != null && memoryDelta >= 30 && Math.abs(liveDelta) <= 1)
      divergences.push('Memory rose while live sessions stayed flat')
    if (liveDelta >= 2 && Math.abs(cpuDelta) <= 2)
      divergences.push('Live sessions grew without added CPU')
  }
  if (cpuPerSession != null && prevCps != null && cpuPerSession - prevCps >= 1)
    divergences.push('Per-session CPU cost is rising')

  return {
    index,
    utc: curr.utc,
    cpu: curr.cpu,
    memoryMb: curr.memoryMb,
    threads: curr.threads,
    cpuDelta,
    memoryDelta,
    threadsDelta,
    liveSessions: live,
    liveDelta,
    cpuPerSession,
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

/** Pearson correlation coefficient of two equal-length series; 0 when undefined. */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i]
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y
  }
  const cov = n * sxy - sx * sy
  const dx = Math.sqrt(n * sxx - sx * sx)
  const dy = Math.sqrt(n * syy - sy * sy)
  const denom = dx * dy
  if (denom === 0) return 0
  return Math.max(-1, Math.min(1, cov / denom))
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

/**
 * Convenience summary series for machine CPU/mem + API threads (independent sections; no cross-fill).
 */
export const METRICS: MetricDef[] = [
  { key: 'cpu', label: 'Machine CPU', unit: '%', color: 'rgb(59,130,246)', fill: 'rgba(59,130,246,0.1)', extract: (s) => s.cpu },
  { key: 'memory', label: 'Machine memory', unit: ' MB', color: 'rgb(168,85,247)', fill: 'rgba(168,85,247,0.1)', extract: (s) => s.memoryMb },
  { key: 'threads', label: 'API threads', unit: '', color: 'rgb(34,197,94)', fill: 'rgba(34,197,94,0.1)', extract: (s) => s.threads },
]

/* ── Section-grouped metric catalog ────────────────────────────────────────
 * Every metric an operator can overlay in the explorer. Machine (`host.*`) is the
 * primary resource plane; `motor.live` and other sections are optional correlation
 * overlays. GC counters are intentionally excluded — they are not part of what we monitor.
 */
export interface MetricSection {
  key: MetricSectionKey
  label: string
  description: string
}

export const METRIC_SECTIONS: MetricSection[] = [
  { key: 'host', label: 'Machine', description: 'Machine CPU, memory, storage, and optional OS resources' },
  { key: 'apiProcess', label: 'API process', description: 'Speculum.Api process and CLR resources' },
  { key: 'motor', label: 'Motor', description: 'Live browsing sessions & throughput' },
  { key: 'sidecar', label: 'Sidecar', description: 'Remote browser connectivity' },
  { key: 'persistence', label: 'Persistence', description: 'Saved browser-state footprint' },
  { key: 'pipeline', label: 'Pipeline', description: 'Diagnostics storage back-pressure' },
  { key: 'derived', label: 'Derived', description: 'Per-session efficiency (resource ÷ sessions)' },
]

function v(key: string): (s: ResourceSample) => number | null {
  return (s) => {
    const x = s.values?.[key]
    return typeof x === 'number' && Number.isFinite(x) ? x : null
  }
}

const C = {
  blue: 'rgb(59,130,246)',
  violet: 'rgb(168,85,247)',
  green: 'rgb(34,197,94)',
  amber: 'rgb(245,158,11)',
  rose: 'rgb(244,63,94)',
  cyan: 'rgb(6,182,212)',
  teal: 'rgb(20,184,166)',
  indigo: 'rgb(99,102,241)',
  orange: 'rgb(249,115,22)',
  pink: 'rgb(236,72,153)',
  lime: 'rgb(132,204,22)',
  slate: 'rgb(100,116,139)',
} as const
const fill = (rgb: string) => rgb.replace('rgb(', 'rgba(').replace(')', ',0.12)')

function m(
  key: string,
  label: string,
  unit: string,
  color: string,
  section: MetricSectionKey,
  description: string,
  defaultAgg: AggFn = 'avg',
): MetricDef {
  return { key, label, unit, color, fill: fill(color), section, description, defaultAgg, extract: v(key) }
}

/** The full overlayable catalog (flat). Use {@link metricsBySection} to group for pickers. */
export const TELEMETRY_METRICS: MetricDef[] = [
  // Machine
  m('host.cpu', 'CPU', '%', C.blue, 'host', 'Machine CPU utilization across all cores.'),
  m('host.memory', 'Memory used', ' MB', C.violet, 'host', 'Machine memory currently in use.'),
  m('host.memoryAvailable', 'Memory available', ' MB', C.teal, 'host', 'Machine memory immediately available to workloads.'),
  m('host.cpuCount', 'CPU count', '', C.green, 'host', 'Logical CPU count exposed by the machine.'),
  m('host.diskFree', 'Disk free', ' GB', C.teal, 'host', 'Free space on the data volume.'),
  m('host.diskTotal', 'Disk total', ' GB', C.indigo, 'host', 'Total capacity of the configured data volume.'),
  m('host.load1m', 'Load 1m', '', C.orange, 'host', 'One-minute machine load average.'),
  m('host.load5m', 'Load 5m', '', C.orange, 'host', 'Five-minute machine load average.'),
  m('host.load15m', 'Load 15m', '', C.orange, 'host', 'Fifteen-minute machine load average.'),
  m('host.swapUsed', 'Swap used', ' MB', C.pink, 'host', 'Machine swap currently in use.'),
  m('host.diskRead', 'Disk read', ' MB/s', C.cyan, 'host', 'Disk read throughput for the configured volume.'),
  m('host.diskWrite', 'Disk write', ' MB/s', C.cyan, 'host', 'Disk write throughput for the configured volume.'),
  m('host.networkRx', 'Network receive', ' MB/s', C.lime, 'host', 'Aggregate network receive throughput.'),
  m('host.networkTx', 'Network transmit', ' MB/s', C.lime, 'host', 'Aggregate network transmit throughput.'),
  m('host.memoryPct', 'Memory used %', '%', C.pink, 'host', 'Machine memory used as a share of total memory.'),
  // API process / CLR
  m('apiProcess.cpu', 'CPU', '%', C.blue, 'apiProcess', 'Speculum.Api process CPU utilization.'),
  m('apiProcess.memory', 'Working set', ' MB', C.violet, 'apiProcess', 'Speculum.Api process working-set memory.'),
  m('apiProcess.threads', 'Threads', '', C.green, 'apiProcess', 'OS threads owned by Speculum.Api.'),
  m('apiProcess.memoryPrivate', 'Private memory', ' MB', C.pink, 'apiProcess', 'Private committed memory held by Speculum.Api.'),
  m('apiProcess.gcHeap', 'GC heap', ' MB', C.indigo, 'apiProcess', 'Managed heap size reported by the CLR.'),
  m('apiProcess.gcGen0', 'GC gen 0', '', C.slate, 'apiProcess', 'CLR generation 0 collection count.', 'max'),
  m('apiProcess.gcGen1', 'GC gen 1', '', C.slate, 'apiProcess', 'CLR generation 1 collection count.', 'max'),
  m('apiProcess.gcGen2', 'GC gen 2', '', C.slate, 'apiProcess', 'CLR generation 2 collection count.', 'max'),
  m('apiProcess.threadPoolBusy', 'Thread pool busy', '', C.orange, 'apiProcess', 'Worker threads currently executing.'),
  m('apiProcess.threadPoolQueued', 'Thread pool queue', '', C.rose, 'apiProcess', 'Work items waiting for an API process worker thread.'),
  // Motor
  m('motor.live', 'Active sessions', '', C.amber, 'motor', 'Live browsing sessions — the load driver.', 'max'),
  m('motor.total', 'Total sessions', '', C.indigo, 'motor', 'Live + starting + stopping sessions.', 'max'),
  m('motor.starting', 'Starting', '', C.cyan, 'motor', 'Sessions still spinning up.', 'max'),
  m('motor.avgFps', 'Avg FPS', '', C.lime, 'motor', 'Mean frame rate across live sessions.'),
  m('motor.minFps', 'Min FPS', '', C.slate, 'motor', 'Slowest live session frame rate.'),
  m('motor.maxFps', 'Max FPS', '', C.lime, 'motor', 'Fastest live session frame rate.'),
  m('motor.stopping', 'Stopping', '', C.slate, 'motor', 'Sessions draining / shutting down.', 'max'),
  m('motor.inputQueue', 'Input queue', '', C.rose, 'motor', 'Pending input events across sessions.', 'max'),
  m('motor.capacityPct', 'Capacity used', '%', C.orange, 'motor', 'Live sessions ÷ max capacity.', 'max'),
  m('motor.frameDepth', 'Frame depth', '', C.pink, 'motor', 'Aggregate frame channel backlog.', 'max'),
  m('motor.statusDepth', 'Status depth', '', C.indigo, 'motor', 'Aggregate status channel backlog.', 'max'),
  // Sidecar
  m('sidecar.connected', 'Sidecar connected', '', C.teal, 'sidecar', 'Remote browsers with a healthy channel.', 'max'),
  m('sidecar.faulted', 'Sidecar faulted', '', C.rose, 'sidecar', 'Remote browsers in a faulted state.', 'max'),
  // Persistence
  m('persistence.stored', 'Stored sessions', '', C.indigo, 'persistence', 'Persisted browser-state records.', 'max'),
  m('persistence.cookies', 'Cookies', '', C.violet, 'persistence', 'Total cookies across stored sessions.'),
  m('persistence.history', 'History entries', '', C.cyan, 'persistence', 'Total history records across stored sessions.'),
  m('persistence.expiringSoon', 'Expiring soon', '', C.amber, 'persistence', 'Persisted sessions expiring within ~1 hour.', 'max'),
  m('persistence.storeBytes', 'Store size', ' MB', C.cyan, 'persistence', 'On-disk browser-state footprint.'),
  // Pipeline
  m('pipeline.bytes', 'Pipeline bytes', ' MB', C.blue, 'pipeline', 'Diagnostics events on disk.'),
  m('pipeline.usedPct', 'Pipeline used', '%', C.amber, 'pipeline', 'Diagnostics storage vs. budget.'),
  m('pipeline.eventsStored', 'Events stored', '', C.green, 'pipeline', 'Total diagnostics events retained.', 'max'),
  m('pipeline.eventsDropped', 'Events dropped', '', C.rose, 'pipeline', 'Events shed under back-pressure.', 'max'),
  m('pipeline.overflow', 'Overflow count', '', C.rose, 'pipeline', 'Storage overflow events.', 'max'),
  m('pipeline.probeInFlight', 'Probes in flight', '', C.orange, 'pipeline', 'Concurrent browser-query probes.', 'max'),
  m('pipeline.recentDrops', 'Recent drops', '', C.rose, 'pipeline', 'Events dropped in the current breaker window.', 'max'),
  m('pipeline.recentSlowWrites', 'Slow writes', '', C.amber, 'pipeline', 'Slow sink writes in the breaker window.', 'max'),
  m('pipeline.degraded', 'Degraded', '', C.rose, 'pipeline', 'Diagnostics circuit breaker tripped (0/1).', 'max'),
  m('pipeline.elevateActive', 'Elevate active', '', C.amber, 'pipeline', 'Temporary Browser Query elevation (0/1).', 'max'),
  // Derived
  m('derived.cpuPerSession', 'CPU / session', '%', C.rose, 'derived', 'CPU% divided by live sessions — efficiency.'),
  m('derived.memPerSession', 'Mem / session', ' MB', C.pink, 'derived', 'Memory (MB) per live session — efficiency.'),
]

export const METRIC_BY_KEY: Record<string, MetricDef> = Object.fromEntries(
  TELEMETRY_METRICS.map((d) => [d.key, d]),
)

/** Default Monitor chart overlays — machine plane only (runtime via + Metric). */
export const MACHINE_MONITOR_DEFAULT_KEYS: readonly string[] = [
  'host.cpu',
  'host.memory',
  'host.diskFree',
]

export function metricsBySection(): { section: MetricSection; metrics: MetricDef[] }[] {
  return METRIC_SECTIONS.map((section) => ({
    section,
    metrics: TELEMETRY_METRICS.filter((mDef) => mDef.section === section.key),
  }))
}

function num(o: Record<string, unknown> | null | undefined, key: string): number | null {
  const x = o?.[key]
  return typeof x === 'number' ? x : null
}
function bool01(o: Record<string, unknown> | null | undefined, key: string): number | null {
  const x = o?.[key]
  if (typeof x !== 'boolean') return null
  return x ? 1 : 0
}
const toMb = (bytes: number | null) => (bytes != null ? Math.round(bytes / (1024 * 1024)) : null)
const toGb = (bytes: number | null) => (bytes != null ? Math.round((bytes / 1024 ** 3) * 10) / 10 : null)

/**
 * Flattens `Telemetry.SampleCollected` events into rich {@link ResourceSample}s: every section
 * (machine/API process/motor/sidecar/persistence/pipeline) is projected into the `values` map keyed by catalog
 * metric key, plus derived per-session efficiency metrics. A sample is retained when **any** section is
 * present so independently toggled sections still share a time axis.
 */
export function telemetryToResourceSamples(events: DiagnosticsEventRecord[]): ResourceSample[] {
  return events
    .filter((e) => e.name === 'Telemetry.SampleCollected')
    .map((evt): ResourceSample | null => {
      const payload = evt.payload as Record<string, unknown> | null
      const host = (payload?.host ?? null) as Record<string, unknown> | null
      const apiProcess = (payload?.apiProcess ?? null) as Record<string, unknown> | null
      const motor = (payload?.motor ?? null) as Record<string, unknown> | null
      const sidecar = (payload?.sidecar ?? null) as Record<string, unknown> | null
      const persistence = (payload?.persistence ?? null) as Record<string, unknown> | null
      const pipeline = (payload?.pipeline ?? null) as Record<string, unknown> | null
      if (!host && !apiProcess && !motor && !sidecar && !persistence && !pipeline) return null

      // Convenience mirrors stay section-pure: cpu/memoryMb = host only; threads = apiProcess only.
      const hostCpu = num(host, 'cpuUsage')
      const apiCpu = num(apiProcess, 'cpuUsage')
      const cpu = hostCpu != null ? Math.round(hostCpu * 10) / 10 : null
      const hostMemMb = toMb(num(host, 'memoryUsed'))
      const apiMemMb = toMb(num(apiProcess, 'memoryUsed'))
      const memMb = hostMemMb
      const memTotal = num(host, 'memoryTotal')
      const threads = num(apiProcess, 'threadCount')
      const live = num(motor, 'live')
      const memPct =
        memTotal != null && memTotal > 0 && num(host, 'memoryUsed') != null
          ? Math.round((num(host, 'memoryUsed')! / memTotal) * 1000) / 10
          : null

      const values: Record<string, number | null> = {
        'host.cpu': cpu,
        'host.memory': hostMemMb,
        'host.memoryAvailable': toMb(num(host, 'memoryAvailable')),
        'host.cpuCount': num(host, 'cpuCount'),
        'host.memoryPct': memPct,
        'host.diskFree': toGb(num(host, 'diskFreeBytes')),
        'host.diskTotal': toGb(num(host, 'diskTotalBytes')),
        'host.load1m': num(host, 'loadAverage1m'),
        'host.load5m': num(host, 'loadAverage5m'),
        'host.load15m': num(host, 'loadAverage15m'),
        'host.swapUsed': toMb(num(host, 'swapUsed')),
        'host.diskRead': toMb(num(host, 'diskReadBytesPerSec')),
        'host.diskWrite': toMb(num(host, 'diskWriteBytesPerSec')),
        'host.networkRx': toMb(num(host, 'networkRxBytesPerSec')),
        'host.networkTx': toMb(num(host, 'networkTxBytesPerSec')),
        'apiProcess.cpu': apiCpu != null ? Math.round(apiCpu * 10) / 10 : null,
        'apiProcess.memory': apiMemMb,
        'apiProcess.threads': threads,
        'apiProcess.memoryPrivate': toMb(num(apiProcess, 'memoryPrivate')),
        'apiProcess.gcHeap': toMb(num(apiProcess, 'gcHeap')),
        'apiProcess.gcGen0': num(apiProcess, 'gcGen0'),
        'apiProcess.gcGen1': num(apiProcess, 'gcGen1'),
        'apiProcess.gcGen2': num(apiProcess, 'gcGen2'),
        'apiProcess.threadPoolBusy': num(apiProcess, 'threadPoolBusy'),
        'apiProcess.threadPoolQueued': num(apiProcess, 'threadPoolQueued'),
        'motor.live': live,
        'motor.total': num(motor, 'total'),
        'motor.starting': num(motor, 'starting'),
        'motor.stopping': num(motor, 'stopping'),
        'motor.avgFps': num(motor, 'avgFps'),
        'motor.minFps': num(motor, 'minFps'),
        'motor.maxFps': num(motor, 'maxFps'),
        'motor.inputQueue': num(motor, 'inputQueueTotal'),
        'motor.capacityPct': num(motor, 'capacityUsedPct'),
        'motor.frameDepth': num(motor, 'frameChannelDepthTotal'),
        'motor.statusDepth': num(motor, 'statusChannelDepthTotal'),
        'sidecar.connected': num(sidecar, 'connected'),
        'sidecar.faulted': num(sidecar, 'faulted'),
        'persistence.stored': num(persistence, 'storedSessions'),
        'persistence.cookies': num(persistence, 'totalCookies'),
        'persistence.history': num(persistence, 'totalHistory'),
        'persistence.expiringSoon': num(persistence, 'expiringSoon'),
        'persistence.storeBytes': toMb(num(persistence, 'storeBytes')),
        'pipeline.bytes': toMb(num(pipeline, 'bytesUsed')),
        'pipeline.usedPct': num(pipeline, 'usedPct'),
        'pipeline.eventsStored': num(pipeline, 'eventsStored'),
        'pipeline.eventsDropped': num(pipeline, 'eventsDropped'),
        'pipeline.overflow': num(pipeline, 'overflowCount'),
        'pipeline.probeInFlight': num(pipeline, 'probeInFlight'),
        'pipeline.recentDrops': num(pipeline, 'recentDrops'),
        'pipeline.recentSlowWrites': num(pipeline, 'recentSlowWrites'),
        'pipeline.degraded': bool01(pipeline, 'degraded'),
        'pipeline.elevateActive': bool01(pipeline, 'elevateActive'),
        // Per-session efficiency is machine load ÷ live sessions (not API-process CPU).
        'derived.cpuPerSession': live != null && live > 0 && cpu != null
          ? Math.round((cpu / live) * 100) / 100
          : null,
        'derived.memPerSession': live != null && live > 0 && hostMemMb != null
          ? Math.round(hostMemMb / live)
          : null,
      }

      return {
        utc: evt.utc,
        timestamp: new Date(evt.utc).getTime(),
        cpu,
        memoryMb: memMb,
        threads,
        values,
      }
    })
    .filter((s): s is ResourceSample => s !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
}

/* ── Nonlinear-scaling anomaly detection (Insights panel) ─────────────────── */

export type AnomalyKind = 'leak' | 'efficiency' | 'regression'

export interface TelemetryAnomaly {
  kind: AnomalyKind
  label: string
  description: string
  startIndex: number
  endIndex: number
  peakIndex: number
  startUtc: string
  endUtc: string
  /** Signed magnitude of the anomaly metric over the window (e.g. CPU % delta). */
  magnitude: number
}

const ANOMALY_META: Record<AnomalyKind, { label: string; describe: (mag: number) => string }> = {
  leak: {
    label: 'Resource climb without new load',
    describe: (mag) => `CPU rose ~${Math.round(mag)}% while live sessions stayed flat — possible leak or runaway work.`,
  },
  efficiency: {
    label: 'Sessions scaled for free',
    describe: (mag) => `Live sessions grew by ~${Math.round(mag)} with little added CPU — batching or idle sessions.`,
  },
  regression: {
    label: 'Per-session cost rising',
    describe: (mag) => `CPU per session climbed ~${mag.toFixed(1)}% — throughput is degrading under load.`,
  },
}

/**
 * Scans a sample series for sustained nonlinear-scaling anomalies by comparing each point to a
 * lookback window. Consecutive hits of the same kind are merged into regions (min length applies).
 */
export function detectAnomalies(
  samples: ResourceSample[],
  opts?: { lookback?: number; minRun?: number },
): TelemetryAnomaly[] {
  const lookback = opts?.lookback ?? 4
  const minRun = opts?.minRun ?? 3
  const n = samples.length
  if (n < lookback + minRun) return []

  const cps = (s: ResourceSample) => {
    const l = liveOf(s)
    return l != null && l > 0 && s.cpu != null ? s.cpu / l : null
  }

  const hits: (AnomalyKind | null)[] = new Array(n).fill(null)
  for (let i = lookback; i < n; i++) {
    const curr = samples[i]
    const base = samples[i - lookback]
    if (curr.cpu == null || base.cpu == null) continue
    const cpuDelta = curr.cpu - base.cpu
    const live = liveOf(curr)
    const baseLive = liveOf(base)
    const liveDelta = live != null && baseLive != null ? live - baseLive : null
    const cpsCurr = cps(curr)
    const cpsBase = cps(base)

    if (liveDelta == null) continue
    if (cpuDelta >= 8 && Math.abs(liveDelta) <= 1) hits[i] = 'leak'
    else if (cpsCurr != null && cpsBase != null && cpsCurr - cpsBase >= 1.2 && liveDelta >= 1) hits[i] = 'regression'
    else if (liveDelta >= 3 && Math.abs(cpuDelta) <= 3) hits[i] = 'efficiency'
  }

  const out: TelemetryAnomaly[] = []
  let start = -1
  for (let i = 0; i <= n; i++) {
    const kind = i < n ? hits[i] : null
    const runKind = start >= 0 ? hits[start] : null
    if (start >= 0 && (kind !== runKind || i === n)) {
      const end = i - 1
      if (end - start + 1 >= minRun && runKind) {
        let peak = start
        let mag = 0
        for (let j = start; j <= end; j++) {
          const base = samples[Math.max(0, j - lookback)]
          const magnitude =
            runKind === 'efficiency'
              ? (liveOf(samples[j]) ?? 0) - (liveOf(base) ?? 0)
              : runKind === 'regression'
                ? (cps(samples[j]) ?? 0) - (cps(base) ?? 0)
                : (samples[j].cpu ?? 0) - (base.cpu ?? 0)
          if (Math.abs(magnitude) > Math.abs(mag)) { mag = magnitude; peak = j }
        }
        out.push({
          kind: runKind,
          label: ANOMALY_META[runKind].label,
          description: ANOMALY_META[runKind].describe(Math.abs(mag)),
          startIndex: start,
          endIndex: end,
          peakIndex: peak,
          startUtc: samples[start].utc,
          endUtc: samples[end].utc,
          magnitude: mag,
        })
      }
      start = -1
    }
    if (i < n && kind && start < 0) start = i
  }
  return out
}

/* ── State windows (degraded / elevate bands) ─────────────────────────────── */

export type StateWindowKind = 'degraded' | 'elevate'

export interface StateWindow {
  kind: StateWindowKind
  startIndex: number
  endIndex: number
  startUtc: string
  endUtc: string
}

/** Merges consecutive samples where pipeline.degraded / elevateActive is 1 into contiguous windows. */
export function extractStateWindows(samples: ResourceSample[]): StateWindow[] {
  const out: StateWindow[] = []
  let degStart = -1
  let elevStart = -1

  const close = (kind: StateWindowKind, start: number, end: number) => {
    if (start < 0 || end < start) return
    out.push({
      kind,
      startIndex: start,
      endIndex: end,
      startUtc: samples[start].utc,
      endUtc: samples[end].utc,
    })
  }

  for (let i = 0; i <= samples.length; i++) {
    const deg = i < samples.length ? samples[i].values?.['pipeline.degraded'] === 1 : false
    const elev = i < samples.length ? samples[i].values?.['pipeline.elevateActive'] === 1 : false

    if (deg && degStart < 0) degStart = i
    if (!deg && degStart >= 0) { close('degraded', degStart, i - 1); degStart = -1 }

    if (elev && elevStart < 0) elevStart = i
    if (!elev && elevStart >= 0) { close('elevate', elevStart, i - 1); elevStart = -1 }
  }
  return out
}

/* ── Per-metric series stats (Monitor inspector / Analysis atlas) ─────────── */

export interface SeriesStats {
  min: number
  avg: number
  max: number
  last: number
  p95: number
  /** Linear slope of value vs index (units per step). */
  trend: number
}

export function seriesStats(samples: ResourceSample[], metric: MetricDef): SeriesStats | null {
  const vals = samples
    .map(metric.extract)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (vals.length === 0) return null
  const base = computeStats(vals)
  const n = vals.length
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += vals[i]; sumXY += i * vals[i]; sumXX += i * i
  }
  const denom = n * sumXX - sumX * sumX
  const trend = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
  return {
    min: base.min,
    avg: base.avg,
    max: base.max,
    last: vals[vals.length - 1],
    p95: base.p95,
    trend: Math.round(trend * 1000) / 1000,
  }
}

/** Tiny SVG path for sparklines (viewBox 0 0 w h). */
export function sparklinePath(values: number[], w = 48, h = 14): string {
  if (values.length === 0) return ''
  if (values.length === 1) {
    const y = h / 2
    return `M0,${y.toFixed(1)} L${w},${y.toFixed(1)}`
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 2) - 1
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
