import { getApiKey } from '@/lib/auth'
import { API_URL, MOCK_MODE } from '@/lib/env'
import { ApiError } from '@/lib/errors'
import { mockDiagnosticsApi } from '@/lib/mock/diagnosticsApi.mock'

type RequestInitEx = RequestInit & { auth?: boolean }

function formatApiError(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      return record.errors.map(String).join('; ')
    }
    if (typeof record.error === 'string') return record.error
    if (typeof record.errorCode === 'string') return record.errorCode
  }
  return `Request failed: ${status}`
}

async function request<T>(path: string, init: RequestInitEx = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  if (init.auth !== false) {
    const key = getApiKey()
    if (key) headers.set('Authorization', `Bearer ${key}`)
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    let body: unknown
    try { body = await res.json() } catch { /* ignore */ }
    throw new ApiError(formatApiError(res.status, body), res.status, body)
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  return text ? JSON.parse(text) as T : (undefined as T)
}

const BASE = '/api/admin/diagnostics/v1'

/** Diagnostics preset — a pre-applied bundle of domain/telemetry toggles (server-seeded). */
export type DiagnosticsProfile = 'Development' | 'Production' | 'Assertive'

/** Signal kind an event carries; the operator control unit per domain. Mirrors DiagnosticsCapability. */
export type DiagnosticsCapability = 'Metric' | 'Event' | 'Snapshot' | 'Probe'

/** Resolved capabilities (post degraded/elevate) per domain: domain -> {capability -> enabled}. */
export type EffectiveCapabilities = Record<string, Partial<Record<DiagnosticsCapability, boolean>>>

/** Always-present elevate projection from the runtime. */
export interface DiagnosticsElevate {
  active?: boolean
  expiresUtc?: string | null
}

export interface DiagnosticsRuntimeSnapshot {
  diagnosticsSchemaVersion: number
  enabled: boolean
  effectiveCapabilities: EffectiveCapabilities
  elevate: DiagnosticsElevate | null
  degraded: boolean
  bytesUsed: number
  storageMaxBytes: number
  eventsStored: number
  eventsDropped: number
  overflowCount: number
  probeInFlight: number
  lastCleanupUtc: string | null
  redactionMode: string
}

export interface DiagnosticsElevateRequest {
  minutes?: number
}

export interface DiagnosticsElevateResponse {
  elevated: boolean
  minutes?: number
}

export interface MotorSessionListItem {
  connectionId: string
  persistedSessionId?: string | null
  sidecarSessionId: string
  phase: string
  currentUrl: string
  starting: boolean
  fps?: number
  uptimeMs?: number
}

export interface MotorSessionDiagnosticsSnapshot {
  connectionId: string
  persistedSessionId?: string | null
  sidecarSessionId: string
  clientToken?: string | null
  correlationId?: string | null
  phase: string
  startedAt?: string | null
  uptimeMs: number
  lastEventUtc: string
  fps: number
  frameSequence: number
  lastFrameUtc?: string | null
  inputQueueApprox: number
  currentUrl: string
  lastNavigateResult?: string | null
  lastNavigateUtc?: string | null
  sidecarConnected: boolean
  lastFault?: string | null
  exportingState: boolean
  forwardingHost?: string | null
  jsBridgeEnabled: boolean
  scriptCount: number
  allowlistCount: number
  profileDomain?: string | null
}

export interface DiagnosticsEventRecord {
  diagnosticsSchemaVersion: number
  id: string
  utc: string
  domain: string
  name: string
  severity: string
  correlationId?: string | null
  connectionId?: string | null
  persistedSessionId?: string | null
  sidecarSessionId?: string | null
  /** Monotonic, process-wide ordering key (schema v2). */
  seq?: number | null
  /** Shared by an open beat and its matching close beat (schema v2). */
  spanId?: string | null
  /** Logical span type, e.g. `motor.navigate` (schema v2). */
  spanKey?: string | null
  /** Span boundary role from the catalog: 'Open' | 'Close' for span beats, absent otherwise (schema v2). */
  spanRole?: 'Open' | 'Close' | null
  /** For standalone beats: the spanId of the innermost open span in scope (schema v2). */
  causationId?: string | null
  payload: unknown
  redaction: string
}

/* ── Telemetry composite sample (payload of Telemetry.SampleCollected) ── */

export interface HostTelemetry {
  hostname: string
  uptimeSec: number
  cpuUsage: number
  memoryUsed: number
  memoryPrivate: number
  memoryTotal: number
  gcHeap: number
  gcGen0: number
  gcGen1: number
  gcGen2: number
  threadCount: number
  threadPoolBusy: number
  threadPoolQueued: number
  diskFreeBytes: number
}

export interface MotorSessionTelemetry {
  connectionId: string
  phase: string
  fps: number
  uptimeMs: number
  inputQueue: number
  sidecarConnected: boolean
  jsBridgeEnabled: boolean
  lastFault?: string | null
  urlHost?: string | null
}

export interface MotorTelemetry {
  total: number
  live: number
  starting: number
  stopping: number
  byPhase: Record<string, number>
  avgFps: number
  minFps: number
  maxFps: number
  inputQueueTotal: number
  frameChannelDepthTotal: number
  statusChannelDepthTotal: number
  capacityMax: number
  capacityUsedPct: number
  liveSessionIds?: string[] | null
  sessions?: MotorSessionTelemetry[] | null
}

export interface SidecarTelemetry {
  connected: number
  faulted: number
  faultedSessionIds?: string[] | null
}

export interface PersistenceTelemetry {
  storedSessions: number
  totalCookies: number
  totalHistory: number
  expiringSoon: number
  storeBytes?: number | null
}

export interface PipelineTelemetry {
  bytesUsed: number
  storageMaxBytes: number
  usedPct: number
  eventsStored: number
  eventsDropped: number
  overflowCount: number
  probeInFlight: number
  degraded: boolean
  elevateActive: boolean
  recentDrops?: number | null
  recentSlowWrites?: number | null
}

export interface TelemetrySample {
  host?: HostTelemetry | null
  motor?: MotorTelemetry | null
  sidecar?: SidecarTelemetry | null
  persistence?: PersistenceTelemetry | null
  pipeline?: PipelineTelemetry | null
}

export interface TelemetryHistoryParams {
  since?: string
  until?: string
  connectionId?: string
  namePrefix?: string
  limit?: number
  cursor?: string | null
  /** When > 0, server returns last-sample-per-bucket over the whole range (chart mode). */
  bucketSeconds?: number
}

/** A telemetry history record: a DiagnosticsEventRecord whose payload is a TelemetrySample. */
export interface TelemetrySampleRecord extends DiagnosticsEventRecord {
  payload: TelemetrySample
}

export interface TelemetryHistoryResponse {
  items: TelemetrySampleRecord[]
  total: number
  nextCursor: string | null
  bucketSeconds: number
  redaction: string
}

export interface BrowserProbeRequest {
  ops: string[]
  evaluateExpression?: string
  domSelector?: string
  correlationId?: string
}

export interface BrowserProbeResponse {
  ok: boolean
  correlationId?: string
  data?: unknown
  redaction?: string
  errorCode?: string
}

export interface DiagnosticsCatalogResponse {
  diagnosticsSchemaVersion: number
  events: string[]
}

/** Per-domain capability toggles (the operator control model). */
export interface DiagnosticsDomainToggles {
  motor: { metrics: boolean; events: boolean; snapshots: boolean }
  sidecar: { metrics: boolean; events: boolean }
  browserQuery: { probe: boolean }
  persisted: { snapshots: boolean }
}

/** Composite telemetry sampler toggles + per-section opt-ins. */
export interface DiagnosticsTelemetryOptions {
  enabled: boolean
  intervalSeconds: number
  host: { enabled: boolean }
  motor: { enabled: boolean; includeSessionIds: boolean; includePerSession: boolean; includeUrlHost: boolean }
  sidecar: { enabled: boolean; includeFaultedIds: boolean }
  persistence: { enabled: boolean; includeBytes: boolean }
  pipeline: { enabled: boolean; includeBreakerPressure: boolean }
}

export interface DiagnosticsOptions {
  enabled: boolean
  profile: DiagnosticsProfile
  domains: DiagnosticsDomainToggles
  telemetry: DiagnosticsTelemetryOptions
  storage: {
    maxBytes: number
    maxEventsPerSession: number
    ttlHours: number
    overflow: string
  }
  sampling: {
    statusMirrorRatio: number
    expensiveEventRatio: number
  }
  elevate: {
    browserQueryMaxMinutes: number
  }
  probe: {
    diagTimeoutMs: number
    maxConcurrentProbesPerSession: number
    maxProbeResponseBytes: number
    hostSampleIntervalMs: number
  }
}

export interface DiagnosticsOverview {
  diagnosticsSchemaVersion: number
  enabled: boolean
  degraded: boolean
  elevate: DiagnosticsRuntimeSnapshot['elevate']
  bytesUsed: number
  storageMaxBytes: number
  eventsStored: number
  eventsDropped: number
  overflowCount: number
  probeInFlight: number
  lastCleanupUtc: string | null
  redactionMode: string
  effectiveCapabilities: EffectiveCapabilities
  liveSessions: { activeCount: number; startingCount: number; total: number }
  needsAttention: string[]
}

const realDiagnosticsApi = {
  getRuntime: () => request<DiagnosticsRuntimeSnapshot>(`${BASE}/runtime`),

  getOverview: () => request<DiagnosticsOverview>(`${BASE}/overview`),

  recover: () =>
    request<{ degraded: boolean; recovered: boolean }>(`${BASE}/recover`, { method: 'POST' }),

  elevate: (body: DiagnosticsElevateRequest) =>
    request<DiagnosticsElevateResponse>(`${BASE}/elevate`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  clearElevate: () =>
    request<DiagnosticsElevateResponse>(`${BASE}/elevate`, { method: 'DELETE' }),

  getHost: async () => {
    const res = await request<{ data: HostTelemetry; redaction: string }>(`${BASE}/host`)
    return (res.data ?? {}) as HostTelemetry
  },

  /**
   * Paged telemetry history for the Telemetry explorer.
   * Raw mode (no bucketSeconds): keyset-paginated via `cursor`, with `total` + `nextCursor`.
   * Chart mode (bucketSeconds > 0): last-sample-per-bucket across the whole [since, until] range.
   */
  getSampleHistory: (params?: TelemetryHistoryParams) => {
    const q = new URLSearchParams()
    if (params?.since) q.set('since', params.since)
    if (params?.until) q.set('until', params.until)
    if (params?.connectionId) q.set('connectionId', params.connectionId)
    if (params?.namePrefix) q.set('namePrefix', params.namePrefix)
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.cursor) q.set('cursor', params.cursor)
    if (params?.bucketSeconds != null) q.set('bucketSeconds', String(params.bucketSeconds))
    const qs = q.toString()
    return request<TelemetryHistoryResponse>(`${BASE}/telemetry/history${qs ? `?${qs}` : ''}`)
  },

  resolve: (params: { connectionId?: string; persistedSessionId?: string; sidecarSessionId?: string }) => {
    const q = new URLSearchParams()
    if (params.connectionId) q.set('connectionId', params.connectionId)
    if (params.persistedSessionId) q.set('persistedSessionId', params.persistedSessionId)
    if (params.sidecarSessionId) q.set('sidecarSessionId', params.sidecarSessionId)
    return request<{ connectionId: string; snapshot: MotorSessionDiagnosticsSnapshot; redaction: string }>(
      `${BASE}/resolve?${q.toString()}`,
    )
  },

  listSessions: () =>
    request<{ activeCount: number; startingCount: number; sessions: MotorSessionListItem[] }>(
      `${BASE}/sessions`,
    ),

  getSession: async (connectionId: string) => {
    const res = await request<{ snapshot: MotorSessionDiagnosticsSnapshot; redaction: string }>(
      `${BASE}/sessions/${encodeURIComponent(connectionId)}`,
    )
    return res.snapshot
  },

  getSessionEvents: (connectionId: string, since?: string, namePrefix?: string) => {
    const q = new URLSearchParams()
    if (since) q.set('since', since)
    if (namePrefix) q.set('namePrefix', namePrefix)
    const qs = q.toString()
    return request<DiagnosticsEventRecord[]>(
      `${BASE}/sessions/${encodeURIComponent(connectionId)}/events${qs ? `?${qs}` : ''}`,
    )
  },

  listEvents: (params?: { since?: string; namePrefix?: string; connectionId?: string }) => {
    const q = new URLSearchParams()
    if (params?.since) q.set('since', params.since)
    if (params?.namePrefix) q.set('namePrefix', params.namePrefix)
    if (params?.connectionId) q.set('connectionId', params.connectionId)
    const qs = q.toString()
    return request<DiagnosticsEventRecord[]>(`${BASE}/events${qs ? `?${qs}` : ''}`)
  },

  runBrowserProbe: (connectionId: string, body: BrowserProbeRequest) =>
    request<BrowserProbeResponse>(
      `${BASE}/sessions/${encodeURIComponent(connectionId)}/browser`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  getEventCatalog: () =>
    request<DiagnosticsCatalogResponse>(`${BASE}/catalog/events`),

  listPersisted: () => request<unknown[]>(`${BASE}/persisted`),

  getPersisted: async (sessionId: string) => {
    const res = await request<{ detail: unknown; redaction: string }>(
      `${BASE}/persisted/${encodeURIComponent(sessionId)}`,
    )
    return res.detail
  },
}

export const diagnosticsApi: typeof realDiagnosticsApi = MOCK_MODE
  ? mockDiagnosticsApi
  : realDiagnosticsApi

export type { ApiError }
