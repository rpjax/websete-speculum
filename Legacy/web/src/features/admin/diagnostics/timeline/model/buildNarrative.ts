import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { detectStoryType, STORY_TYPES } from '@/lib/diagnosticsConstants'
import { narrateStory } from '@/lib/diagnosticsDescriptions'
import type { CorrelationStory } from '@/lib/hooks/useCorrelationStories'
import type {
  BeatCluster,
  ChapterOutcome,
  Narrative,
  NarrativeBeat,
  NarrativeChapter,
  NarrativeLane,
  NarrativePeriod,
  NarrativeScope,
  NarrativeSpan,
  ReadingFilters,
  SpanStatus,
} from './narrativeTypes'

/** Synthetic close published by the SpanTracker for spans it had to abandon. */
export const SPAN_ABANDONED_EVENT = 'Diagnostics.SpanAbandoned'

const CLUSTER_WINDOW_MS = 80

function isCloseBeat(evt: DiagnosticsEventRecord): boolean {
  return evt.spanRole === 'Close' || evt.name === SPAN_ABANDONED_EVENT
}

/** Total order for beats: monotonic seq first, then utc, then id (stable tiebreak). */
export function compareEvents(a: DiagnosticsEventRecord, b: DiagnosticsEventRecord): number {
  const sa = a.seq
  const sb = b.seq
  if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb) return sa - sb
  const ta = Date.parse(a.utc)
  const tb = Date.parse(b.utc)
  if (ta !== tb) return ta - tb
  return a.id.localeCompare(b.id)
}

export function orderEvents(events: DiagnosticsEventRecord[]): DiagnosticsEventRecord[] {
  return [...events].sort(compareEvents)
}

export function buildSpans(events: DiagnosticsEventRecord[]): NarrativeSpan[] {
  const bySpan = new Map<string, DiagnosticsEventRecord[]>()
  for (const evt of events) {
    if (!evt.spanId) continue
    const list = bySpan.get(evt.spanId) ?? []
    list.push(evt)
    bySpan.set(evt.spanId, list)
  }

  const raw: NarrativeSpan[] = []
  for (const [spanId, group] of bySpan) {
    const ordered = group.sort(compareEvents)
    if (ordered.length === 1 && isCloseBeat(ordered[0])) continue
    const open = ordered[0]
    const close = ordered.length > 1 ? ordered[ordered.length - 1] : null
    const startMs = Date.parse(open.utc)
    const endMs = close ? Date.parse(close.utc) : null
    const status: SpanStatus = close === null
      ? 'open'
      : close.name === SPAN_ABANDONED_EVENT
        ? 'abandoned'
        : 'closed'
    const ok = status === 'closed'
      && close!.severity !== 'Error'
      && close!.severity !== 'Warning'

    raw.push({
      spanId,
      spanKey: open.spanKey ?? close?.spanKey ?? null,
      open,
      close,
      startMs,
      endMs,
      durationMs: endMs === null ? null : Math.max(0, endMs - startMs),
      status,
      ok,
      connectionId: open.connectionId ?? close?.connectionId ?? null,
      correlationId: open.correlationId ?? close?.correlationId ?? null,
      depth: 0,
    })
  }

  const byId = new Map(raw.map((s) => [s.spanId, s]))
  for (const span of raw)
    span.depth = spanDepth(span, byId, new Set())

  raw.sort((a, b) => a.startMs - b.startMs || a.depth - b.depth)
  return raw
}

function spanDepth(span: NarrativeSpan, byId: Map<string, NarrativeSpan>, seen: Set<string>): number {
  const parentSpanId = span.open.causationId
  if (!parentSpanId || seen.has(span.spanId)) return 0
  seen.add(span.spanId)
  const parent = byId.get(parentSpanId)
  if (!parent) return 0
  return 1 + spanDepth(parent, byId, seen)
}

function chapterOutcome(events: DiagnosticsEventRecord[], spans: NarrativeSpan[]): ChapterOutcome {
  if (events.some((e) => e.severity === 'Error' || /Failed|Rejected|TimedOut|Refused|Blocked/.test(e.name)))
    return 'failed'
  if (events.some((e) => e.severity === 'Warning') || spans.some((s) => s.status === 'abandoned' || !s.ok))
    return 'warning'
  if (spans.some((s) => s.status === 'open')) return 'open'
  if (events.length > 0) return 'ok'
  return 'unknown'
}

function toBeat(event: DiagnosticsEventRecord): NarrativeBeat {
  return { event, ms: Date.parse(event.utc), clusterKey: null }
}

function buildChapters(events: DiagnosticsEventRecord[]): NarrativeChapter[] {
  const groups = new Map<string, DiagnosticsEventRecord[]>()
  for (const evt of events) {
    const key = evt.correlationId
      ? `corr:${evt.correlationId}`
      : evt.connectionId
        ? `conn:${evt.connectionId}`
        : 'system'
    const list = groups.get(key) ?? []
    list.push(evt)
    groups.set(key, list)
  }

  const chapters: NarrativeChapter[] = []
  for (const [key, groupEvents] of groups) {
    const ordered = orderEvents(groupEvents)
    const spans = buildSpans(ordered)
    const beats = ordered.map(toBeat)
    const startMs = Date.parse(ordered[0].utc)
    const lastBeatMs = Date.parse(ordered[ordered.length - 1].utc)
    const endMs = spans.reduce((max, s) => Math.max(max, s.endMs ?? s.startMs), lastBeatMs)
    const type = detectStoryType(ordered.map((e) => e.name))
    const correlationId = ordered.find((e) => e.correlationId)?.correlationId ?? key
    const connectionId = ordered.find((e) => e.connectionId)?.connectionId ?? null
    const storyLike: CorrelationStory = {
      correlationId,
      connectionId,
      events: ordered,
      type,
      latestUtc: ordered[ordered.length - 1].utc,
      earliestUtc: ordered[0].utc,
      durationMs: Math.max(0, endMs - startMs),
    }
    const typeLabel = STORY_TYPES[type]?.label ?? 'Activity'
    chapters.push({
      key,
      correlationId: ordered.find((e) => e.correlationId)?.correlationId ?? null,
      connectionId,
      beats,
      spans,
      startMs,
      endMs,
      durationMs: Math.max(0, endMs - startMs),
      errorCount: ordered.filter((e) => e.severity === 'Error' || e.severity === 'Warning').length,
      outcome: chapterOutcome(ordered, spans),
      proseHint: `${typeLabel}: ${narrateStory(storyLike)}`,
    })
  }

  chapters.sort((a, b) => a.startMs - b.startMs)
  return chapters
}

export function clusterBeats(beats: NarrativeBeat[], windowMs = CLUSTER_WINDOW_MS): BeatCluster[] {
  if (beats.length === 0) return []
  const ordered = [...beats].sort((a, b) => a.ms - b.ms || a.event.id.localeCompare(b.event.id))
  const clusters: BeatCluster[] = []
  let current: BeatCluster | null = null

  for (const beat of ordered) {
    if (!current || beat.ms - current.ms > windowMs) {
      current = { key: `c:${beat.event.id}`, ms: beat.ms, beats: [beat] }
      clusters.push(current)
    } else {
      current.beats.push(beat)
    }
    beat.clusterKey = current.key
  }
  return clusters
}

function humanSessionLabel(connectionId: string): string {
  const parts = connectionId.split('-')
  if (parts.length >= 3) return `Session ${parts.slice(1, 3).join('-').toUpperCase()}`
  return connectionId.length > 18 ? `Session ${connectionId.slice(0, 18)}…` : `Session ${connectionId}`
}

function buildLanes(chapters: NarrativeChapter[], allBeats: NarrativeBeat[]): NarrativeLane[] {
  const laneMap = new Map<string, NarrativeLane>()

  function ensure(kind: 'session' | 'system', id: string): NarrativeLane {
    const existing = laneMap.get(id)
    if (existing) return existing
    const lane: NarrativeLane = {
      kind,
      id,
      label: kind === 'system' ? 'System' : humanSessionLabel(id),
      chapters: [],
      beats: [],
    }
    laneMap.set(id, lane)
    return lane
  }

  for (const chapter of chapters) {
    const lane = chapter.connectionId
      ? ensure('session', chapter.connectionId)
      : ensure('system', 'system')
    lane.chapters.push(chapter)
  }

  for (const beat of allBeats) {
    const lane = beat.event.connectionId
      ? ensure('session', beat.event.connectionId)
      : ensure('system', 'system')
    lane.beats.push(beat)
  }

  const lanes = [...laneMap.values()]
  lanes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'system' ? 1 : -1
    const aStart = a.beats[0]?.ms ?? a.chapters[0]?.startMs ?? 0
    const bStart = b.beats[0]?.ms ?? b.chapters[0]?.startMs ?? 0
    return aStart - bStart
  })
  return lanes
}

export function resolvePeriodBounds(period: NarrativePeriod, nowMs = Date.now()): { fromMs: number; toMs: number } {
  const toMs = period.toMs ?? nowMs
  if (period.preset === 'custom' && period.fromMs != null) {
    return { fromMs: period.fromMs, toMs: period.toMs ?? nowMs }
  }
  const map: Record<string, number> = {
    '15m': 15 * 60_000,
    '1h': 3600_000,
    '6h': 6 * 3600_000,
    '24h': 86400_000,
  }
  if (period.preset === 'all') {
    return { fromMs: period.fromMs ?? 0, toMs }
  }
  const span = map[period.preset] ?? 3600_000
  return { fromMs: period.fromMs ?? (toMs - span), toMs }
}

export function filterEventsInPeriod(
  events: DiagnosticsEventRecord[],
  period: NarrativePeriod,
  nowMs = Date.now(),
): { events: DiagnosticsEventRecord[]; filteredUntilClient: boolean } {
  const { fromMs, toMs } = resolvePeriodBounds(period, nowMs)
  const filtered = events.filter((e) => {
    const t = Date.parse(e.utc)
    return t >= fromMs && t <= toMs
  })
  const filteredUntilClient = period.toMs != null || period.preset !== 'all'
  return { events: filtered, filteredUntilClient }
}

export function applyReadingFilters(
  events: DiagnosticsEventRecord[],
  filters: ReadingFilters,
): DiagnosticsEventRecord[] {
  return events.filter((e) => {
    if (filters.domains.length > 0 && !filters.domains.includes(e.domain)) return false
    if (filters.severities.length > 0 && !filters.severities.includes(e.severity)) return false
    if (filters.search.trim()) {
      const terms = filters.search.toLowerCase().split(/\s+/).filter(Boolean)
      const text = `${e.name} ${e.domain} ${e.severity} ${e.connectionId ?? ''} ${e.correlationId ?? ''}`.toLowerCase()
      if (!terms.every((t) => text.includes(t))) return false
    }
    return true
  })
}

export interface BuildNarrativeInput {
  events: DiagnosticsEventRecord[]
  scope: NarrativeScope
  period: NarrativePeriod
  filters?: ReadingFilters
  /** When true, until was applied only on the client (server lacked until=). */
  untilAppliedClientSide?: boolean
}

export function buildNarrative(input: BuildNarrativeInput): Narrative {
  let scopeFiltered = input.events
  if (input.scope.kind === 'session') {
    const connectionId = input.scope.connectionId
    scopeFiltered = input.events.filter((e) => e.connectionId === connectionId)
  }

  const { events: periodEvents, filteredUntilClient } = filterEventsInPeriod(scopeFiltered, input.period)
  const events = applyReadingFilters(periodEvents, input.filters ?? { domains: [], severities: [], search: '' })
  const chapters = buildChapters(events)
  const allBeats = events.map(toBeat)
  const clusters = clusterBeats(allBeats)
  const lanes = buildLanes(chapters, allBeats)

  let startMs = Number.POSITIVE_INFINITY
  let endMs = Number.NEGATIVE_INFINITY
  for (const e of events) {
    const t = Date.parse(e.utc)
    if (t < startMs) startMs = t
    if (t > endMs) endMs = t
  }
  if (!Number.isFinite(startMs)) {
    const bounds = resolvePeriodBounds(input.period)
    startMs = bounds.fromMs
    endMs = bounds.toMs
  }

  const untilNote = input.untilAppliedClientSide || filteredUntilClient
    ? 'Period upper bound applied on the client; prefer server until= when available.'
    : null

  return {
    scope: input.scope,
    period: input.period,
    lanes,
    chapters,
    clusters,
    startMs,
    endMs: Math.max(endMs, startMs + 1),
    eventCount: events.length,
    completeness: {
      filteredUntilClient: input.untilAppliedClientSide ?? filteredUntilClient,
      note: untilNote,
    },
  }
}

/** @deprecated Prefer NarrativeChapter — kept for transitional SpanTimeline imports. */
export type Span = NarrativeSpan
/** @deprecated Prefer NarrativeChapter */
export type Story = {
  key: string
  correlationId: string | null
  connectionId: string | null
  events: DiagnosticsEventRecord[]
  spans: NarrativeSpan[]
  startMs: number
  endMs: number
  durationMs: number
  errorCount: number
}

export function buildStories(events: DiagnosticsEventRecord[]): Story[] {
  return buildChapters(events)
    .map((c) => ({
      key: c.key,
      correlationId: c.correlationId,
      connectionId: c.connectionId,
      events: c.beats.map((b) => b.event),
      spans: c.spans,
      startMs: c.startMs,
      endMs: c.endMs,
      durationMs: c.durationMs,
      errorCount: c.errorCount,
    }))
    .sort((a, b) => b.startMs - a.startMs)
}
