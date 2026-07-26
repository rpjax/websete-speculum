import type {
  ApiProcessTelemetry,
  DiagnosticsEventRecord,
  DiagnosticsOverview,
  DiagnosticsRuntimeSnapshot,
  HostTelemetry,
} from '@/lib/diagnosticsApi'
import { EVENT_DESCRIPTIONS } from '@/lib/diagnosticsDescriptions'
import {
  TELEMETRY_METRICS,
  METRIC_BY_KEY,
  detectAnomalies,
  extractStateWindows,
  pearson,
  seriesStats,
  type MetricDef,
  type ResourceSample,
  type TelemetryAnomaly,
  type StateWindow,
} from '@/lib/resourceChartCompute'

/* ── Coverage & input ─────────────────────────────────────────────────────── */

export interface AnalysisCoverage {
  samples: number
  bucketed: boolean
  truncated: boolean
  events: number
  dataSources: string[]
}

export interface AnalysisWindow {
  since: string
  until: string
  spanMs: number
}

export interface AnalysisConsumeInput {
  samples: ResourceSample[]
  events: DiagnosticsEventRecord[]
  runtime: DiagnosticsRuntimeSnapshot | null
  overview: DiagnosticsOverview | null
  host: HostTelemetry | null
  apiProcess: ApiProcessTelemetry | null
  window: AnalysisWindow
  coverage: AnalysisCoverage
}

/* ── Report types ─────────────────────────────────────────────────────────── */

export type HealthVerdict = 'healthy' | 'watch' | 'degraded' | 'critical'

export interface AnalysisChapter {
  id: string
  title: string
  summary: string
  /** Didactic long-form prose paragraphs. */
  body: string[]
  evidenceRefs: EvidenceRef[]
}

export interface EvidenceRef {
  label: string
  since: string
  until: string
  kind: 'samples' | 'events' | 'state'
}

export interface MetricFinding {
  key: string
  label: string
  section: string
  unit: string
  present: boolean
  min: number | null
  avg: number | null
  max: number | null
  last: number | null
  p95: number | null
  trend: number | null
  volatility: number | null
  narrative: string
}

export interface CorrelationFinding {
  xKey: string
  yKey: string
  xLabel: string
  yLabel: string
  r: number
  strength: 'strong' | 'moderate' | 'weak' | 'none'
  expected: boolean
  healthy: boolean
  narrative: string
}

export interface ChronologyEntry {
  utc: string
  kind: 'event' | 'state'
  title: string
  detail: string
  severity: 'info' | 'warning' | 'error'
}

export interface ReportAnomaly {
  id: string
  title: string
  detail: string
  severity: 'watch' | 'warning' | 'critical'
  startUtc: string
  endUtc: string
  action?: string
}

export interface StabilityFinding {
  id: string
  title: string
  detail: string
}

export interface Conclusion {
  rank: number
  title: string
  detail: string
}

export interface GuidanceItem {
  priority: 'low' | 'medium' | 'high'
  title: string
  action: string
}

export interface TelemetryAnalysisReport {
  meta: {
    analyzedAt: string
    window: AnalysisWindow
    coverage: AnalysisCoverage
  }
  executive: {
    headline: string
    healthScore: number
    verdict: HealthVerdict
    periodSummary: string
  }
  chapters: AnalysisChapter[]
  metricAtlas: MetricFinding[]
  correlations: CorrelationFinding[]
  chronology: ChronologyEntry[]
  anomalies: ReportAnomaly[]
  stability: StabilityFinding[]
  conclusions: Conclusion[]
  guidance: GuidanceItem[]
}

/* ── Engine ───────────────────────────────────────────────────────────────── */

const CORRELATION_PAIRS: { x: string; y: string; expected: boolean; why: string }[] = [
  { x: 'motor.live', y: 'host.cpu', expected: true, why: 'Machine CPU should track live session load roughly linearly.' },
  { x: 'motor.live', y: 'host.memory', expected: true, why: 'Machine memory use usually rises with live sessions.' },
  { x: 'motor.live', y: 'apiProcess.cpu', expected: true, why: 'API process CPU should rise with live session orchestration load.' },
  { x: 'motor.live', y: 'apiProcess.memory', expected: true, why: 'API working set usually grows with live session bookkeeping.' },
  { x: 'motor.live', y: 'derived.cpuPerSession', expected: false, why: 'Per-session CPU should stay stable when scaling is healthy.' },
  { x: 'host.cpu', y: 'host.memory', expected: true, why: 'Machine CPU and memory often move together under real work.' },
  { x: 'host.cpu', y: 'apiProcess.cpu', expected: true, why: 'API process CPU is a share of machine CPU under normal load.' },
  { x: 'apiProcess.gcHeap', y: 'apiProcess.memory', expected: true, why: 'Managed heap growth usually appears in the API working set.' },
  { x: 'motor.live', y: 'sidecar.connected', expected: true, why: 'Connected sidecars should match live browsing sessions.' },
  { x: 'pipeline.usedPct', y: 'pipeline.eventsDropped', expected: true, why: 'Storage pressure tends to precede drops.' },
  { x: 'host.cpu', y: 'pipeline.recentSlowWrites', expected: true, why: 'Machine load can slow diagnostics sink writes.' },
  { x: 'motor.capacityPct', y: 'motor.live', expected: true, why: 'Capacity used is driven by live (+ starting) sessions.' },
]

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return (Math.round(n * 10 ** digits) / 10 ** digits).toLocaleString()
}

function strengthOf(r: number): CorrelationFinding['strength'] {
  const a = Math.abs(r)
  if (a > 0.85) return 'strong'
  if (a > 0.5) return 'moderate'
  if (a > 0.2) return 'weak'
  return 'none'
}

function stddev(vals: number[]): number {
  if (vals.length < 2) return 0
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  const v = vals.reduce((a, b) => a + (b - avg) ** 2, 0) / vals.length
  return Math.sqrt(v)
}

function presentKeys(samples: ResourceSample[]): Set<string> {
  const keys = new Set<string>()
  for (const s of samples) {
    if (!s.values) continue
    for (const [k, v] of Object.entries(s.values)) {
      if (typeof v === 'number') keys.add(k)
    }
  }
  return keys
}

function buildMetricAtlas(samples: ResourceSample[]): MetricFinding[] {
  const present = presentKeys(samples)
  return TELEMETRY_METRICS.map((m) => {
    const has = present.has(m.key)
    const stats = has ? seriesStats(samples, m) : null
    const vals = has
      ? samples.map(m.extract).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      : []
    const vol = vals.length > 1 ? stddev(vals) : null
    const narrative = !has
      ? `${m.label} was not collected in this window (section toggle off or absent from samples).`
      : buildMetricNarrative(m, stats!, vol)
    return {
      key: m.key,
      label: m.label,
      section: m.section ?? 'host',
      unit: m.unit,
      present: has,
      min: stats?.min ?? null,
      avg: stats?.avg ?? null,
      max: stats?.max ?? null,
      last: stats?.last ?? null,
      p95: stats?.p95 ?? null,
      trend: stats?.trend ?? null,
      volatility: vol != null ? Math.round(vol * 100) / 100 : null,
      narrative,
    }
  })
}

function buildMetricNarrative(m: MetricDef, stats: NonNullable<ReturnType<typeof seriesStats>>, vol: number | null): string {
  const trendWord =
    Math.abs(stats.trend) < 0.05 ? 'essentially flat'
      : stats.trend > 0 ? `gently rising (~${fmt(stats.trend)} per step)`
        : `gently falling (~${fmt(stats.trend)} per step)`
  const volWord =
    vol == null ? ''
      : vol < (Math.abs(stats.avg) * 0.05 + 0.5) ? ' Low volatility — a calm series.'
        : vol < (Math.abs(stats.avg) * 0.2 + 2) ? ' Moderate variability across the window.'
          : ' High variability — expect spikes and troughs.'
  return (
    `${m.description ?? m.label} Across this window, ${m.label.toLowerCase()} ranged from ` +
    `${fmt(stats.min)}${m.unit} to ${fmt(stats.max)}${m.unit} (avg ${fmt(stats.avg)}${m.unit}, ` +
    `p95 ${fmt(stats.p95)}${m.unit}, last ${fmt(stats.last)}${m.unit}). The trend is ${trendWord}.${volWord}`
  )
}

function buildCorrelations(samples: ResourceSample[]): CorrelationFinding[] {
  if (samples.length < 4) return []
  const out: CorrelationFinding[] = []
  for (const pair of CORRELATION_PAIRS) {
    const xm = METRIC_BY_KEY[pair.x]
    const ym = METRIC_BY_KEY[pair.y]
    if (!xm || !ym) continue
    const paired = samples
      .map((s) => ({ x: xm.extract(s), y: ym.extract(s) }))
      .filter((p): p is { x: number; y: number } => p.x != null && p.y != null)
    if (paired.length < 4) continue
    const xs = paired.map((p) => p.x)
    const ys = paired.map((p) => p.y)
    const r = pearson(xs, ys)
    const strength = strengthOf(r)
    const healthy = pair.expected
      ? Math.abs(r) >= 0.5
      : Math.abs(r) < 0.5 || (pair.x.includes('cpuPerSession') && Math.abs(r) < 0.4)
    const narrative = pair.expected
      ? healthy
        ? `${ym.label} tracked ${xm.label} with ${strength} correlation (r=${r.toFixed(2)}). ${pair.why} This is healthy scaling behavior.`
        : `${ym.label} did not track ${xm.label} as expected (r=${r.toFixed(2)}, ${strength}). ${pair.why} Investigate nonlinear load or idle sessions.`
      : `Correlation between ${xm.label} and ${ym.label} is ${strength} (r=${r.toFixed(2)}). ${pair.why}`
    out.push({
      xKey: pair.x,
      yKey: pair.y,
      xLabel: xm.label,
      yLabel: ym.label,
      r: Math.round(r * 1000) / 1000,
      strength,
      expected: pair.expected,
      healthy,
      narrative,
    })
  }
  return out
}

function countEvents(events: DiagnosticsEventRecord[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const e of events) {
    counts[e.name] = (counts[e.name] ?? 0) + 1
  }
  return counts
}

function buildChronology(events: DiagnosticsEventRecord[], windows: StateWindow[]): ChronologyEntry[] {
  const entries: ChronologyEntry[] = []
  for (const w of windows) {
    entries.push({
      utc: w.startUtc,
      kind: 'state',
      title: w.kind === 'degraded' ? 'Diagnostics entered Degraded' : 'Browser Query elevate became active',
      detail: w.kind === 'degraded'
        ? `Circuit breaker pressure window lasting until ${new Date(w.endUtc).toLocaleString()}. Probes and deeper capabilities may have been capped.`
        : `Temporary elevation window lasting until ${new Date(w.endUtc).toLocaleString()}. Deeper browser inspection was unlocked.`,
      severity: w.kind === 'degraded' ? 'warning' : 'info',
    })
  }
  const notable = new Set([
    'Diagnostics.Degraded', 'Diagnostics.Recovered', 'Diagnostics.ElevateStarted', 'Diagnostics.ElevateExpired',
    'Diagnostics.StorageOverflow', 'Motor.SessionStarted', 'Motor.SessionFailed', 'Motor.SessionRefused',
    'Motor.SidecarFault', 'Motor.DrainStarted', 'Motor.DrainCompleted',
  ])
  for (const e of events) {
    if (!notable.has(e.name)) continue
    const desc = EVENT_DESCRIPTIONS[e.name] ?? e.name
    entries.push({
      utc: e.utc,
      kind: 'event',
      title: e.name,
      detail: desc,
      severity: e.severity === 'Error' || e.severity === 'error' ? 'error'
        : e.severity === 'Warning' || e.severity === 'warning' ? 'warning'
          : 'info',
    })
  }
  return entries.sort((a, b) => a.utc.localeCompare(b.utc))
}

function buildAnomalies(
  samples: ResourceSample[],
  detected: TelemetryAnomaly[],
  windows: StateWindow[],
  correlations: CorrelationFinding[],
): ReportAnomaly[] {
  const out: ReportAnomaly[] = detected.map((a, i) => ({
    id: `anom-${a.kind}-${i}`,
    title: a.label,
    detail: a.description,
    severity: a.kind === 'leak' || a.kind === 'regression' ? 'warning' : 'watch',
    startUtc: a.startUtc,
    endUtc: a.endUtc,
    action: a.kind === 'leak'
      ? 'Inspect long-lived sessions and background work during the window; compare CPU with live session count on the Monitor chart.'
      : a.kind === 'regression'
        ? 'Check per-session cost trend and sidecar health; look for frame/input queue growth.'
        : 'Confirm whether sessions were idle or batching; not always a fault.',
  }))

  // Sustained saturation
  if (samples.length >= 8) {
    const highCpu = samples.filter((s) => s.cpu != null && s.cpu >= 85).length
    if (samples.length > 0 && highCpu / samples.length >= 0.25) {
      out.push({
        id: 'sat-cpu',
        title: 'Sustained high CPU',
        detail: `CPU stayed at or above 85% for ${highCpu} of ${samples.length} samples (${Math.round((highCpu / samples.length) * 100)}% of the window). Sustained saturation leaves little headroom for new sessions.`,
        severity: 'warning',
        startUtc: samples[0].utc,
        endUtc: samples[samples.length - 1].utc,
        action: 'Review capacity limits and session FPS/input queues; consider reducing concurrent load.',
      })
    }
  }

  // Disk ETA
  const disk = samples.map((s) => s.values?.['host.diskFree']).filter((v): v is number => typeof v === 'number')
  if (disk.length >= 6) {
    const first = disk[0]
    const last = disk[disk.length - 1]
    const drop = first - last
    if (drop > 0.05 && last < first) {
      const spanMs = samples[samples.length - 1].timestamp - samples[0].timestamp
      const ratePerMs = drop / Math.max(1, spanMs)
      const etaMs = ratePerMs > 0 ? last / ratePerMs : Infinity
      if (etaMs < 7 * 24 * 3600_000) {
        const etaHours = Math.round(etaMs / 3600_000)
        out.push({
          id: 'disk-eta',
          title: 'Disk free space trending down',
          detail: `Free disk fell from ${fmt(first)} GB to ${fmt(last)} GB over the window. At this rate, exhaustion is roughly ${etaHours} hours away (linear projection — verify retention and log growth).`,
          severity: etaHours < 48 ? 'critical' : 'watch',
          startUtc: samples[0].utc,
          endUtc: samples[samples.length - 1].utc,
          action: 'Check diagnostics storage budgets, purge policy, and host volume capacity.',
        })
      }
    }
  }

  for (const w of windows.filter((x) => x.kind === 'degraded')) {
    out.push({
      id: `state-deg-${w.startIndex}`,
      title: 'Diagnostics degraded window',
      detail: `The diagnostics circuit was degraded from ${new Date(w.startUtc).toLocaleString()} to ${new Date(w.endUtc).toLocaleString()}. During this time, deeper capabilities may have been capped and pipeline pressure elevated.`,
      severity: 'warning',
      startUtc: w.startUtc,
      endUtc: w.endUtc,
      action: 'Review recent drops/slow writes and recover the circuit if it is still degraded.',
    })
  }

  for (const c of correlations.filter((x) => x.expected && !x.healthy)) {
    out.push({
      id: `corr-break-${c.xKey}-${c.yKey}`,
      title: `Broken correlation: ${c.yLabel} vs ${c.xLabel}`,
      detail: c.narrative,
      severity: 'watch',
      startUtc: samples[0]?.utc ?? '',
      endUtc: samples[samples.length - 1]?.utc ?? '',
      action: 'Open Analysis deep dive or Monitor overlay for these two metrics across the same window.',
    })
  }

  // Capacity ceiling
  const cap = samples.map((s) => s.values?.['motor.capacityPct']).filter((v): v is number => typeof v === 'number')
  if (cap.some((v) => v >= 90)) {
    const peak = Math.max(...cap)
    out.push({
      id: 'cap-ceiling',
      title: 'Capacity near ceiling',
      detail: `Motor capacity used peaked at ${fmt(peak)}%. Session refusals become likely when capacity saturates.`,
      severity: peak >= 98 ? 'critical' : 'warning',
      startUtc: samples[0].utc,
      endUtc: samples[samples.length - 1].utc,
      action: 'Review MaxSessions and live session count; drain idle sessions if appropriate.',
    })
  }

  return out
}

function buildStability(
  samples: ResourceSample[],
  correlations: CorrelationFinding[],
  anomalies: ReportAnomaly[],
  atlas: MetricFinding[],
): StabilityFinding[] {
  const out: StabilityFinding[] = []
  const healthyCorr = correlations.filter((c) => c.expected && c.healthy)
  for (const c of healthyCorr.slice(0, 4)) {
    out.push({
      id: `stable-corr-${c.xKey}-${c.yKey}`,
      title: `${c.yLabel} tracked ${c.xLabel}`,
      detail: c.narrative,
    })
  }

  const cpu = atlas.find((m) => m.key === 'host.cpu')
  if (cpu?.present && cpu.avg != null && cpu.avg < 45 && (cpu.volatility ?? 0) < 15) {
    out.push({
      id: 'stable-cpu',
      title: 'Machine CPU remained within a comfortable band',
      detail: `Average machine CPU was ${fmt(cpu.avg)}% with limited volatility. The machine had headroom for additional live sessions through most of this window.`,
    })
  }

  const apiCpu = atlas.find((m) => m.key === 'apiProcess.cpu')
  if (apiCpu?.present && apiCpu.avg != null && apiCpu.avg < 35 && (apiCpu.volatility ?? 0) < 20) {
    out.push({
      id: 'stable-api-cpu',
      title: 'API process CPU stayed moderate',
      detail: `Speculum.Api averaged ${fmt(apiCpu.avg)}% CPU with limited volatility — orchestration load did not crowd the CLR process.`,
    })
  }

  const pipe = atlas.find((m) => m.key === 'pipeline.usedPct')
  if (pipe?.present && pipe.max != null && pipe.max < 70) {
    out.push({
      id: 'stable-pipeline',
      title: 'Diagnostics storage stayed under budget pressure',
      detail: `Pipeline used peaked at ${fmt(pipe.max)}% of the configured budget — no sustained storage crisis in this window.`,
    })
  }

  const deg = samples.filter((s) => s.values?.['pipeline.degraded'] === 1).length
  if (deg === 0 && samples.length > 0) {
    out.push({
      id: 'stable-circuit',
      title: 'Diagnostics circuit stayed healthy',
      detail: 'No sample in this window reported pipeline.degraded=1. The breaker did not trip on this time axis.',
    })
  }

  if (anomalies.length === 0 && samples.length >= 4) {
    out.push({
      id: 'stable-no-anom',
      title: 'No nonlinear-scaling anomalies detected',
      detail: 'Resource usage tracked live sessions without sustained leak, free-scaling, or per-session cost regression patterns.',
    })
  }

  // Always provide at least one stability note when data exists
  if (out.length === 0 && samples.length > 0) {
    out.push({
      id: 'stable-data',
      title: 'Telemetry coverage was continuous enough to analyze',
      detail: `The analyzer ingested ${samples.length} samples across the chosen window and built a full metric atlas from available sections.`,
    })
  }
  return out
}

function buildEventChapter(events: DiagnosticsEventRecord[]): AnalysisChapter {
  const counts = countEvents(events)
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const body: string[] = [
    `This window contains ${events.length} diagnostics events across Motor, Sidecar, Persistence, Telemetry, and DiagnosticsSelf domains. Event volume alone does not mean trouble — it is the activity log of the motor and its observers.`,
  ]
  if (entries.length === 0) {
    body.push('No non-telemetry chronology events were returned for this window. The report still covers the numeric telemetry atlas and correlations.')
  } else {
    const top = entries.slice(0, 8).map(([name, n]) => `${name} (${n})`).join(', ')
    body.push(`Most frequent names: ${top}.`)
    for (const [name, n] of entries.slice(0, 5)) {
      const desc = EVENT_DESCRIPTIONS[name]
      if (desc) body.push(`• ${name} ×${n}: ${desc}`)
    }
    const starts = counts['Motor.SessionStarted'] ?? 0
    const fails = counts['Motor.SessionFailed'] ?? 0
    const refused = counts['Motor.SessionRefused'] ?? 0
    const faults = counts['Motor.SidecarFault'] ?? 0
    body.push(
      `Session lifecycle in this window: ${starts} successful start(s), ${fails} failure(s), ${refused} capacity refusal(s), ${faults} sidecar fault(s). ` +
      `Compare these beats with CPU/memory spikes in the metric atlas — startups and faults often explain short resource bursts.`,
    )
  }
  const first = events[0]?.utc
  const last = events[events.length - 1]?.utc
  return {
    id: 'events',
    title: 'Event narrative',
    summary: `${events.length} events narrate what the motor and diagnostics pipeline did alongside the numeric samples.`,
    body,
    evidenceRefs: first && last ? [{ label: 'Events in window', since: first, until: last, kind: 'events' }] : [],
  }
}

function scoreHealth(anomalies: ReportAnomaly[], windows: StateWindow[], correlations: CorrelationFinding[]): { score: number; verdict: HealthVerdict } {
  let score = 92
  for (const a of anomalies) {
    if (a.severity === 'critical') score -= 18
    else if (a.severity === 'warning') score -= 10
    else score -= 4
  }
  score -= windows.filter((w) => w.kind === 'degraded').length * 8
  score -= correlations.filter((c) => c.expected && !c.healthy).length * 5
  score = Math.max(5, Math.min(100, score))
  const verdict: HealthVerdict =
    score >= 85 ? 'healthy' : score >= 70 ? 'watch' : score >= 45 ? 'degraded' : 'critical'
  return { score, verdict }
}

/**
 * Deterministic multi-pass analyzer: turns samples + events + context into a complete
 * didactic TelemetryAnalysisReport (not a problem-only alert list).
 */
export function composeTelemetryAnalysis(input: AnalysisConsumeInput): TelemetryAnalysisReport {
  const { samples, events, runtime, overview, host, apiProcess, window, coverage } = input
  const analyzedAt = new Date().toISOString()
  const atlas = buildMetricAtlas(samples)
  const correlations = buildCorrelations(samples)
  const windows = extractStateWindows(samples)
  const detected = detectAnomalies(samples)
  const anomalies = buildAnomalies(samples, detected, windows, correlations)
  const stability = buildStability(samples, correlations, anomalies, atlas)
  const chronology = buildChronology(events, windows)
  const { score, verdict } = scoreHealth(anomalies, windows, correlations)

  const spanMin = Math.round(window.spanMs / 60_000)
  const live = atlas.find((m) => m.key === 'motor.live')
  const hostCpu = atlas.find((m) => m.key === 'host.cpu')
  const hostMem = atlas.find((m) => m.key === 'host.memory')
  const apiCpu = atlas.find((m) => m.key === 'apiProcess.cpu')
  const apiMem = atlas.find((m) => m.key === 'apiProcess.memory')

  const periodChapter: AnalysisChapter = {
    id: 'period',
    title: 'Period framing',
    summary: `Analysis covers ${spanMin} minutes with ${coverage.samples} telemetry sample(s)${coverage.truncated ? ' (substrate / truncated ingest)' : ''}. Machine resources lead; runtime overlays are secondary context.`,
    body: [
      `You asked the analyzer to explain the period from ${new Date(window.since).toLocaleString()} to ${new Date(window.until).toLocaleString()} (${spanMin} minutes). ` +
      `This window is independent of the Monitor chart — Analysis owns its own range. The primary resource plane is the machine (host); API process, motor, sidecar, persistence, and pipeline are correlation overlays.`,
      coverage.bucketed || coverage.truncated
        ? `Coverage note: the ingest used a ${coverage.bucketed ? 'bucketed substrate' : 'truncated series'} (${coverage.samples} points). Findings remain directionally valid; extrema may be smoothed.`
        : `Coverage note: the full raw sample series was consumed (${coverage.samples} points). Statistical findings use that full series.`,
      `Data sources: ${coverage.dataSources.join(', ') || 'none'}. Events ingested: ${coverage.events}.`,
      host
        ? `Machine context at analysis time: ${host.hostname}, uptime ${Math.round(host.uptimeSec / 3600)}h, live probe CPU ${fmt(host.cpuUsage)}% (source ${host.source ?? '—'}).`
        : 'Machine live probe was not available; the report relies on sample payloads only.',
      hostCpu?.present || hostMem?.present
        ? `Machine series in samples: CPU ${hostCpu?.present ? `avg ${fmt(hostCpu.avg)}%` : 'absent'}; memory ${hostMem?.present ? `avg ${fmt(hostMem.avg)} MB` : 'absent'}.`
        : 'Machine section was not present in samples for this window.',
      `Sections observed in samples: ${[...new Set(atlas.filter((m) => m.present).map((m) => m.section))].join(', ') || 'none'}. ` +
      `Absent sections usually mean their Telemetry toggles were off for part of the window.`,
      apiProcess
        ? `API process overlay at analysis time: CPU ${fmt(apiProcess.cpuUsage)}%, working set ${apiProcess.memoryUsed != null ? `${fmt(apiProcess.memoryUsed / (1024 * 1024))} MB` : '—'}, threads ${apiProcess.threadCount ?? '—'} — independent of machine gauges.`
        : 'API process live probe was not available (optional overlay).',
      overview
        ? `Overview context: ${overview.liveSessions?.activeCount ?? '—'} active / ${overview.liveSessions?.startingCount ?? '—'} starting sessions; diagnostics ${overview.degraded ? 'DEGRADED' : 'not degraded'}; elevate ${overview.elevate?.active ? 'active' : 'inactive'}.`
        : 'Overview snapshot was not available.',
      runtime
        ? `Diagnostics control plane (not machine resources): storage ${fmt(runtime.bytesUsed / (1024 * 1024))} MB of ${fmt(runtime.storageMaxBytes / (1024 * 1024))} MB budget; ${runtime.eventsStored} events stored, ${runtime.eventsDropped} dropped, overflow ${runtime.overflowCount}.`
        : 'Diagnostics runtime snapshot was not available.',
    ],
    evidenceRefs: [{ label: 'Full analysis window', since: window.since, until: window.until, kind: 'samples' }],
  }

  const atlasChapter: AnalysisChapter = {
    id: 'atlas',
    title: 'Metric atlas',
    summary: `${atlas.filter((m) => m.present).length} of ${atlas.length} catalog metrics were present and summarized.`,
    body: [
      'The metric atlas is the complete numeric story of this window — not only alarms. Each present metric carries range, average, p95, trend, and a short explanation of what the shape means.',
      ...atlas.filter((m) => m.present).slice(0, 12).map((m) => m.narrative),
      atlas.filter((m) => m.present).length > 12
        ? `…and ${atlas.filter((m) => m.present).length - 12} additional present metrics are listed in the atlas table below.`
        : 'All present metrics are narrated above or in the atlas table.',
    ],
    evidenceRefs: [{ label: 'Samples for atlas', since: window.since, until: window.until, kind: 'samples' }],
  }

  const corrChapter: AnalysisChapter = {
    id: 'correlations',
    title: 'Cross-section correlations',
    summary: `${correlations.length} metric pairs evaluated; ${correlations.filter((c) => c.healthy).length} healthy, ${correlations.filter((c) => c.expected && !c.healthy).length} expected-but-broken.`,
    body: [
      'Correlation answers whether sections move together. Machine↔live-session pairs are the primary story; API process↔motor pairs are optional overlays. Broken expected pairs are a nonlinear-scaling smell. Healthy pairs are first-class findings — they belong in the report even when nothing is wrong.',
      ...correlations.map((c) => c.narrative),
    ],
    evidenceRefs: [{ label: 'Correlation window', since: window.since, until: window.until, kind: 'samples' }],
  }

  const efficiencyChapter: AnalysisChapter = {
    id: 'efficiency',
    title: 'Efficiency & capacity story',
    summary: hostCpu?.present
      ? `Machine CPU averaged ${fmt(hostCpu.avg)}%; live sessions and API process are narrated as overlays.`
      : live?.present
        ? `Live sessions averaged ${fmt(live.avg)}; machine CPU series was absent — runtime overlays only.`
        : 'Machine and live-session series were limited; efficiency ratios are sparse.',
    body: [
      hostCpu?.present
        ? `Machine CPU averaged ${fmt(hostCpu.avg)}% (peak ${fmt(hostCpu.max)}%) — primary resource plane.`
        : 'Machine CPU section was not present in samples.',
      hostMem?.present
        ? `Machine memory averaged ${fmt(hostMem.avg)} MB (peak ${fmt(hostMem.max)} MB).`
        : '',
      live?.present
        ? `Active sessions (runtime overlay) ranged ${fmt(live.min)}–${fmt(live.max)} (avg ${fmt(live.avg)}).`
        : 'Motor live-session series was not present.',
      apiCpu?.present
        ? `API process CPU averaged ${fmt(apiCpu.avg)}% (peak ${fmt(apiCpu.max)}%) — independent overlay, not machine CPU.`
        : 'API process CPU section was not present in samples.',
      (() => {
        const cps = atlas.find((m) => m.key === 'derived.cpuPerSession')
        const mps = atlas.find((m) => m.key === 'derived.memPerSession')
        if (!cps?.present && !mps?.present) return 'Per-session derived metrics were unavailable (no live sessions or machine section missing).'
        return [
          cps?.present ? `Machine CPU per live session averaged ${fmt(cps.avg)}% (p95 ${fmt(cps.p95)}%). Rising unit cost under growing load is a regression smell.` : '',
          mps?.present ? `Machine memory per live session averaged ${fmt(mps.avg)} MB.` : '',
        ].filter(Boolean).join(' ')
      })(),
      (() => {
        const cap = atlas.find((m) => m.key === 'motor.capacityPct')
        return cap?.present
          ? `Capacity used averaged ${fmt(cap.avg)}% and peaked at ${fmt(cap.max)}%. Staying near 100% predicts SessionRefused events.`
          : 'Capacity percentage was not present in samples.'
      })(),
      apiMem?.present
        ? `API working set averaged ${fmt(apiMem.avg)} MB (peak ${fmt(apiMem.max)} MB) — independent of machine memory.`
        : '',
    ].filter(Boolean),
    evidenceRefs: [{ label: 'Efficiency window', since: window.since, until: window.until, kind: 'samples' }],
  }

  const stateChapter: AnalysisChapter = {
    id: 'state',
    title: 'State chronology',
    summary: `${windows.length} telemetry state window(s); ${chronology.length} chronology entries including notable events.`,
    body: [
      'State chronology merges pipeline.degraded / elevateActive bands from samples with notable diagnostics and motor events. Together they explain *when* the system changed posture — not only *that* a number moved.',
      windows.length === 0
        ? 'No degraded or elevate bands were present on the sample time axis.'
        : windows.map((w) =>
          `${w.kind === 'degraded' ? 'Degraded' : 'Elevate'} from ${new Date(w.startUtc).toLocaleString()} to ${new Date(w.endUtc).toLocaleString()}.`,
        ).join(' '),
      chronology.length > 0
        ? `Notable beats: ${chronology.slice(0, 6).map((c) => `${c.title} @ ${new Date(c.utc).toLocaleTimeString()}`).join('; ')}.`
        : 'No notable chronology events overlapped this window.',
    ],
    evidenceRefs: windows.map((w) => ({
      label: `${w.kind} window`,
      since: w.startUtc,
      until: w.endUtc,
      kind: 'state' as const,
    })),
  }

  const eventChapter = buildEventChapter(events)

  const riskChapter: AnalysisChapter = {
    id: 'risk',
    title: 'Anomalies & risk',
    summary: anomalies.length === 0
      ? 'No material anomalies were flagged — risk chapter is quiet, by design.'
      : `${anomalies.length} risk finding(s). This chapter is one part of the report, not the whole report.`,
    body: [
      'Anomalies transform suspicious shapes into operator language. They sit beside stability findings — a healthy period can still mention a brief watch item without becoming an alarm list.',
      ...(anomalies.length === 0
        ? ['No leak, regression, saturation, disk-ETA, capacity-ceiling, or broken-correlation findings met thresholds in this window.']
        : anomalies.map((a) => `• ${a.title}: ${a.detail}${a.action ? ` Suggested action: ${a.action}` : ''}`)),
    ],
    evidenceRefs: anomalies.slice(0, 5).map((a) => ({
      label: a.title,
      since: a.startUtc,
      until: a.endUtc,
      kind: 'samples' as const,
    })),
  }

  const stabilityChapter: AnalysisChapter = {
    id: 'stability',
    title: 'Stability & health',
    summary: `${stability.length} positive or calm finding(s) — what went well or stayed within budget.`,
    body: [
      'A complete report must say what worked. Stability findings record healthy correlations, comfortable CPU bands, storage headroom, and quiet anomaly detectors.',
      ...stability.map((s) => `• ${s.title}: ${s.detail}`),
    ],
    evidenceRefs: [{ label: 'Full window', since: window.since, until: window.until, kind: 'samples' }],
  }

  const conclusions: Conclusion[] = [
    {
      rank: 1,
      title: verdict === 'healthy' ? 'Machine resources look operationally sound' : `Period verdict: ${verdict}`,
      detail: `Health score ${score}/100. ${stability.find((s) => s.id === 'stable-cpu')?.detail ?? stability[0]?.detail ?? ''} ${anomalies[0] ? `Primary concern: ${anomalies[0].title}.` : 'No primary anomaly.'}`,
    },
    {
      rank: 2,
      title: 'Machine load vs sessions',
      detail: hostCpu?.present && live?.present
        ? `Machine CPU avg ${fmt(hostCpu.avg)}%; live sessions avg ${fmt(live.avg)}. ${correlations.find((c) => c.xKey === 'motor.live' && c.yKey === 'host.cpu')?.narrative ?? ''}`
        : hostCpu?.present
          ? `Machine CPU avg ${fmt(hostCpu.avg)}% (peak ${fmt(hostCpu.max)}%). Live-session overlay was absent.`
          : live?.present && apiCpu?.present
            ? `Machine CPU absent — live sessions avg ${fmt(live.avg)}; API process CPU avg ${fmt(apiCpu.avg)}% (overlay only).`
            : 'Insufficient data to conclude on machine CPU.',
    },
    {
      rank: 3,
      title: 'Diagnostics posture',
      detail: windows.some((w) => w.kind === 'degraded')
        ? 'At least one degraded window occurred — treat pipeline pressure and recoverability as part of the story.'
        : 'No degraded sample bands; diagnostics posture on the time axis stayed up.',
    },
  ]

  const guidance: GuidanceItem[] = []
  for (const a of anomalies.filter((x) => x.action).slice(0, 5)) {
    guidance.push({
      priority: a.severity === 'critical' ? 'high' : a.severity === 'warning' ? 'medium' : 'low',
      title: a.title,
      action: a.action!,
    })
  }
  if (guidance.length === 0) {
    guidance.push({
      priority: 'low',
      title: 'Keep observing on Monitor',
      action: 'No urgent actions. Use Monitor overlays if you want to visually confirm the atlas narratives for this same free-chosen window.',
    })
  }

  const headline =
    verdict === 'healthy'
      ? hostCpu?.present
        ? `Healthy machine period: CPU avg ${fmt(hostCpu.avg)}% across ${spanMin} minutes`
        : `Healthy period: machine and overlays largely agreed across ${spanMin} minutes`
      : verdict === 'watch'
        ? `Watch items on machine resources in a ${spanMin}-minute window`
        : verdict === 'degraded'
          ? `Degraded machine or pipeline signals across the analyzed ${spanMin}-minute window`
          : `Critical pressure detected in the analyzed ${spanMin}-minute window`

  const periodSummary =
    `Machine-led analysis of ${coverage.samples} telemetry samples and ${coverage.events} events. ` +
    `${atlas.filter((m) => m.present).length} metrics narrated; ${stability.length} stability finding(s); ${anomalies.length} risk finding(s). ` +
    (coverage.truncated ? 'Ingest was truncated to a substrate — treat fine extrema cautiously. ' : '') +
    `Verdict ${verdict} (score ${score}).`

  return {
    meta: { analyzedAt, window, coverage },
    executive: { headline, healthScore: score, verdict, periodSummary },
    chapters: [periodChapter, atlasChapter, corrChapter, efficiencyChapter, stateChapter, eventChapter, riskChapter, stabilityChapter],
    metricAtlas: atlas,
    correlations,
    chronology,
    anomalies,
    stability,
    conclusions,
    guidance,
  }
}
