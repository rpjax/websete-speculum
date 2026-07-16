import type {
  DiagnosticsRuntimeSnapshot,
  DiagnosticsOverview,
  DiagnosticsElevateRequest,
  DiagnosticsElevateResponse,
  MotorSessionListItem,
  MotorSessionDiagnosticsSnapshot,
  DiagnosticsEventRecord,
  BrowserProbeRequest,
  BrowserProbeResponse,
  DiagnosticsCatalogResponse,
  HostTelemetry,
  TelemetryHistoryParams,
  TelemetryHistoryResponse,
  TelemetrySampleRecord,
} from '@/lib/diagnosticsApi'
import { delay } from './delay'
import {
  overview as baseOverview,
  runtime as baseRuntime,
  liveSessions as baseLiveSessions,
  sessionSnapshot,
  eventsList,
  catalog,
  probeResult,
  hostSample,
  persistedList,
  telemetrySamples,
} from './fixtures'

let overviewState: DiagnosticsOverview = structuredClone(baseOverview)
let runtimeState: DiagnosticsRuntimeSnapshot = structuredClone(baseRuntime)
let sessions = [...baseLiveSessions]
let events: DiagnosticsEventRecord[] = eventsList()
const telemetry: TelemetrySampleRecord[] = telemetrySamples()

function encodeCursor(utc: string, id: string): string {
  return btoa(`${utc}|${id}`)
}
function decodeCursor(cursor?: string | null): { utc: string; id: string } | null {
  if (!cursor) return null
  try {
    const raw = atob(cursor)
    const idx = raw.indexOf('|')
    if (idx <= 0) return null
    return { utc: raw.slice(0, idx), id: raw.slice(idx + 1) }
  } catch {
    return null
  }
}

export const mockDiagnosticsApi = {
  getRuntime: () => delay<DiagnosticsRuntimeSnapshot>(structuredClone(runtimeState)),

  getOverview: () => delay<DiagnosticsOverview>(structuredClone(overviewState)),

  recover: () => {
    overviewState = { ...overviewState, degraded: false, needsAttention: [] }
    runtimeState = { ...runtimeState, degraded: false }
    return delay({ degraded: false, recovered: true })
  },

  elevate: (body: DiagnosticsElevateRequest) => {
    const resp: DiagnosticsElevateResponse = {
      elevated: true,
      minutes: body.minutes ?? 10,
    }
    overviewState = {
      ...overviewState,
      elevate: {
        active: true,
        expiresUtc: new Date(Date.now() + (resp.minutes ?? 10) * 60_000).toISOString(),
      },
    }
    runtimeState = {
      ...runtimeState,
      elevate: overviewState.elevate,
    }
    return delay(resp)
  },

  clearElevate: () => {
    overviewState = { ...overviewState, elevate: null }
    runtimeState = { ...runtimeState, elevate: null }
    return delay<DiagnosticsElevateResponse>({ elevated: false })
  },

  getHost: () => delay<HostTelemetry>(structuredClone(hostSample)),

  getSampleHistory: (params?: TelemetryHistoryParams) => {
    const prefix = params?.namePrefix ?? 'Telemetry.'
    let matched = telemetry.filter((e) => e.name.startsWith(prefix))
    if (params?.since) matched = matched.filter((e) => e.utc >= params.since!)
    if (params?.until) matched = matched.filter((e) => e.utc <= params.until!)
    if (params?.connectionId) matched = matched.filter((e) => e.connectionId === params.connectionId)
    // Stable ascending order (utc, id) — mirrors the server keyset ordering.
    matched = [...matched].sort((a, b) => (a.utc === b.utc ? a.id.localeCompare(b.id) : a.utc.localeCompare(b.utc)))

    // Chart mode: last-sample-per-bucket across the whole range.
    if (params?.bucketSeconds && params.bucketSeconds > 0) {
      const bucketMs = params.bucketSeconds * 1000
      const order: number[] = []
      const lastPerBucket = new Map<number, TelemetrySampleRecord>()
      for (const e of matched) {
        const bucket = Math.floor(new Date(e.utc).getTime() / bucketMs)
        if (!lastPerBucket.has(bucket)) order.push(bucket)
        lastPerBucket.set(bucket, e)
      }
      const items = order.map((b) => lastPerBucket.get(b)!)
      return delay<TelemetryHistoryResponse>({
        items: structuredClone(items),
        total: items.length,
        nextCursor: null,
        bucketSeconds: params.bucketSeconds,
        redaction: 'none',
      })
    }

    // Raw mode: keyset pagination by cursor.
    const total = matched.length
    const cursor = decodeCursor(params?.cursor)
    let startIdx = 0
    if (cursor) {
      startIdx = matched.findIndex(
        (e) => e.utc > cursor.utc || (e.utc === cursor.utc && e.id > cursor.id),
      )
      if (startIdx < 0) startIdx = matched.length
    }
    const limit = Math.max(1, Math.min(2000, params?.limit ?? 200))
    const page = matched.slice(startIdx, startIdx + limit)
    const hasMore = startIdx + limit < matched.length
    const last = page[page.length - 1]
    return delay<TelemetryHistoryResponse>({
      items: structuredClone(page),
      total,
      nextCursor: hasMore && last ? encodeCursor(last.utc, last.id) : null,
      bucketSeconds: 0,
      redaction: 'none',
    })
  },

  resolve: (params: { connectionId?: string; persistedSessionId?: string; sidecarSessionId?: string }) => {
    const connId =
      params.connectionId ??
      sessions.find(
        (s) =>
          s.persistedSessionId === params.persistedSessionId ||
          s.sidecarSessionId === params.sidecarSessionId,
      )?.connectionId ??
      sessions[0].connectionId
    return delay({
      connectionId: connId,
      snapshot: sessionSnapshot(connId),
      redaction: 'none',
    })
  },

  listSessions: () =>
    delay({
      activeCount: sessions.filter((s) => !s.starting).length,
      startingCount: sessions.filter((s) => s.starting).length,
      sessions: structuredClone(sessions) as MotorSessionListItem[],
    }),

  getSession: (connectionId: string) =>
    delay<MotorSessionDiagnosticsSnapshot>(sessionSnapshot(connectionId)),

  getSessionEvents: (connectionId: string, since?: string, namePrefix?: string, until?: string) => {
    let filtered = events.filter((e) => e.connectionId === connectionId)
    if (since) filtered = filtered.filter((e) => e.utc >= since)
    if (until) filtered = filtered.filter((e) => e.utc <= until)
    if (namePrefix) filtered = filtered.filter((e) => e.name.startsWith(namePrefix))
    return delay<DiagnosticsEventRecord[]>(structuredClone(filtered))
  },

  listEvents: (params?: { since?: string; until?: string; namePrefix?: string; connectionId?: string }) => {
    let filtered = [...events]
    if (params?.since) filtered = filtered.filter((e) => e.utc >= params.since!)
    if (params?.until) filtered = filtered.filter((e) => e.utc <= params.until!)
    if (params?.namePrefix) filtered = filtered.filter((e) => e.name.startsWith(params.namePrefix!))
    if (params?.connectionId) filtered = filtered.filter((e) => e.connectionId === params.connectionId)
    return delay<DiagnosticsEventRecord[]>(structuredClone(filtered))
  },

  runBrowserProbe: (_connectionId: string, body: BrowserProbeRequest) =>
    delay<BrowserProbeResponse>(probeResult(body.ops)),

  getEventCatalog: () => delay<DiagnosticsCatalogResponse>(structuredClone(catalog)),

  listPersisted: () => delay<unknown[]>(structuredClone(persistedList)),

  getPersisted: (sessionId: string) => {
    const item = persistedList.find((p) => p.sessionId === sessionId)
    return delay(item ?? { sessionId, cookies: [], localStorage: [], idbRecords: [], history: [] })
  },
}

export function _resetMockDiagnosticsApi() {
  overviewState = structuredClone(baseOverview)
  runtimeState = structuredClone(baseRuntime)
  sessions = [...baseLiveSessions]
  events = eventsList()
}
