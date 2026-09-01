import { adminJson } from '@/lib/adminFetch'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

export type TimelineEvent = {
  id: string
  sequence: number
  publishedAt: string
  type: string
  schemaVersion: number
  publishPolicy: string
  indexKeys: Record<string, string>
  payload: unknown
}

export type TimelineResponse = {
  items: TimelineEvent[]
  latestSequence: number | null
  nextBeforeSequence: number | null
  truncated: boolean
}

export type TimelineQuery = {
  since?: string
  until?: string
  type?: string
  typePrefix?: string
  sessionId?: string
  afterSequence?: number
  beforeSequence?: number
  limit?: number
}

export function fetchTimeline(query: TimelineQuery = {}): Promise<TimelineResponse> {
  const params = new URLSearchParams()
  if (query.since) params.set('since', query.since)
  if (query.until) params.set('until', query.until)
  if (query.type) params.set('type', query.type)
  if (query.typePrefix) params.set('typePrefix', query.typePrefix)
  if (query.sessionId) params.set('sessionId', query.sessionId)
  if (query.afterSequence != null) params.set('afterSequence', String(query.afterSequence))
  if (query.beforeSequence != null) params.set('beforeSequence', String(query.beforeSequence))
  if (query.limit != null) params.set('limit', String(query.limit))
  const qs = params.toString()
  return adminJson<TimelineResponse>(`/api/admin/diagnostics/v1/timeline${qs ? `?${qs}` : ''}`)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function inferSeverity(type: string, payload: Record<string, unknown> | null): string {
  // SessionTimedOut is a natural lifecycle close (detached collection), never Error.
  if (/SessionTimedOut$/i.test(type)) return 'Info'
  const fromPayload = str(payload?.severity)
  if (fromPayload) return fromPayload
  if (/Failed|Rejected|Refused|Blocked|Fault/i.test(type)) return 'Error'
  if (/DiagProbeTimedOut|ProbeTimedOut/i.test(type)) return 'Error'
  if (/Warning|Degraded|Abandoned/i.test(type)) return 'Warning'
  if (/SampleCollected|Metric|Gauge|Counter/i.test(type)) return 'Metric'
  return 'Info'
}

function inferSpanRole(value: unknown): 'Open' | 'Close' | null {
  if (value === 'Open' || value === 'Close') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'open') return 'Open'
    if (normalized === 'close') return 'Close'
  }
  return null
}

/**
 * Map durable Journal timeline facts into the narrative event envelope used by
 * buildNarrative (lanes / chapters / spans / beats).
 */
export function journalToNarrativeEvent(item: TimelineEvent): DiagnosticsEventRecord {
  const type = item.type
  const domain = type.includes('.') ? type.slice(0, type.indexOf('.')) : type
  const keys = item.indexKeys ?? {}
  const payload = asRecord(item.payload)
  const sessionId =
    str(keys.session) ??
    str(keys.connectionId) ??
    str(keys.ConnectionId) ??
    str(payload?.sessionId) ??
    str(payload?.connectionId)

  const correlationFromEnvelope =
    str(payload?.correlationId) ?? str(keys.correlation) ?? str(keys.correlationId)

  // Without correlation, group platform facts by concrete type so the canvas
  // shows typed chapters instead of one opaque System blob.
  const correlationId = correlationFromEnvelope ?? (sessionId ? null : `type:${type}`)

  const utc =
    typeof item.publishedAt === 'string'
      ? item.publishedAt
      : new Date(item.publishedAt as unknown as string).toISOString()

  return {
    diagnosticsSchemaVersion: item.schemaVersion,
    id: item.id,
    utc,
    domain,
    name: type,
    severity: inferSeverity(type, payload),
    correlationId,
    connectionId: sessionId,
    persistedSessionId: str(keys.persistedSessionId) ?? str(payload?.persistedSessionId),
    sidecarSessionId: str(keys.sidecarSessionId) ?? str(payload?.sidecarSessionId),
    seq: item.sequence,
    spanId: str(payload?.spanId),
    spanKey: str(payload?.spanKey),
    spanRole: inferSpanRole(payload?.spanRole),
    causationId: str(payload?.causationId),
    payload: item.payload,
    redaction: /best/i.test(item.publishPolicy) ? 'best-effort' : 'none',
  }
}

export function journalPageToNarrativeEvents(items: TimelineEvent[]): DiagnosticsEventRecord[] {
  return items.map(journalToNarrativeEvent)
}
