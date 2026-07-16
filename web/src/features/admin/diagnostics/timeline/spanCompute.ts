import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

/**
 * Span + story reconstruction from the raw event stream (schema v2). The backend stamps
 * `spanId`/`spanKey`/`seq`/`causationId` on the envelope; here we pair Open/Close beats into
 * spans and group correlated beats into stories so the admin UI can plot a per-session,
 * chronological narrative. Pure + deterministic — see spanCompute.test.ts.
 */

export type SpanStatus = 'open' | 'closed' | 'abandoned'

export interface Span {
  spanId: string
  spanKey: string | null
  open: DiagnosticsEventRecord
  /** The matching close beat, or null while the span is still open. */
  close: DiagnosticsEventRecord | null
  startMs: number
  endMs: number | null
  durationMs: number | null
  status: SpanStatus
  /** True only for a clean close (not abandoned, not Warning/Error severity). */
  ok: boolean
  connectionId: string | null
  correlationId: string | null
  /** Nesting level from the causation chain (0 = top-level). */
  depth: number
}

export interface Story {
  key: string
  correlationId: string | null
  connectionId: string | null
  /** Beats ordered by seq (falling back to utc, then id) — the narrative order. */
  events: DiagnosticsEventRecord[]
  spans: Span[]
  startMs: number
  endMs: number
  durationMs: number
  errorCount: number
}

/** Synthetic close published by the SpanTracker for spans it had to abandon. */
export const SPAN_ABANDONED_EVENT = 'Diagnostics.SpanAbandoned'

/**
 * Whether a beat closes a span. Prefers the catalog-derived `spanRole` from the wire; falls back
 * to the abandon marker for older records that predate `spanRole` (so a lone abandon is never
 * mistaken for an open span).
 */
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

/**
 * Pairs Open/Close beats by `spanId`. A span id appears on its open beat and (once closed) on
 * its close beat; a lone open is still-running, and a close whose name is the abandon marker is
 * a timeout/teardown/recovery close. Beats without a span id (standalone or close-without-open)
 * are ignored here — they surface in the story's flat beat list.
 */
export function buildSpans(events: DiagnosticsEventRecord[]): Span[] {
  const bySpan = new Map<string, DiagnosticsEventRecord[]>()
  for (const evt of events) {
    if (!evt.spanId) continue
    const list = bySpan.get(evt.spanId) ?? []
    list.push(evt)
    bySpan.set(evt.spanId, list)
  }

  const raw: Span[] = []
  for (const [spanId, group] of bySpan) {
    const ordered = group.sort(compareEvents)
    // A lone beat that is a Close (its Open fell outside the query window, or was trimmed by
    // retention) has no known start — skip it rather than render a phantom "still open" bar. It
    // still surfaces in the story's flat beat list.
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

  // Resolve nesting depth from the causation chain (open beat's causationId -> parent spanId).
  const byId = new Map(raw.map((s) => [s.spanId, s]))
  for (const span of raw)
    span.depth = spanDepth(span, byId, new Set())

  raw.sort((a, b) => a.startMs - b.startMs || a.depth - b.depth)
  return raw
}

function spanDepth(span: Span, byId: Map<string, Span>, seen: Set<string>): number {
  const parentSpanId = span.open.causationId
  if (!parentSpanId || seen.has(span.spanId)) return 0
  seen.add(span.spanId)
  const parent = byId.get(parentSpanId)
  if (!parent) return 0
  return 1 + spanDepth(parent, byId, seen)
}

/**
 * Groups beats into stories: by correlationId when present (the operation lineage), else by
 * connectionId (the session lane), else a shared system bucket. Each story's beats are ordered
 * and its spans reconstructed, so a story reads as "what happened, in order, and how long".
 */
export function buildStories(events: DiagnosticsEventRecord[]): Story[] {
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

  const stories: Story[] = []
  for (const [key, groupEvents] of groups) {
    const ordered = orderEvents(groupEvents)
    const spans = buildSpans(ordered)
    const startMs = Date.parse(ordered[0].utc)
    const lastBeatMs = Date.parse(ordered[ordered.length - 1].utc)
    const endMs = spans.reduce((max, s) => Math.max(max, s.endMs ?? s.startMs), lastBeatMs)
    stories.push({
      key,
      correlationId: ordered.find((e) => e.correlationId)?.correlationId ?? null,
      connectionId: ordered.find((e) => e.connectionId)?.connectionId ?? null,
      events: ordered,
      spans,
      startMs,
      endMs,
      durationMs: Math.max(0, endMs - startMs),
      errorCount: ordered.filter((e) => e.severity === 'Error' || e.severity === 'Warning').length,
    })
  }

  // Most-recent story first (matches the rest of the diagnostics UI).
  stories.sort((a, b) => b.startMs - a.startMs)
  return stories
}
