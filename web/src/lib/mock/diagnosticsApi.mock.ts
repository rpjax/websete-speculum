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
} from './fixtures'

let overviewState: DiagnosticsOverview = structuredClone(baseOverview)
let runtimeState: DiagnosticsRuntimeSnapshot = structuredClone(baseRuntime)
let sessions = [...baseLiveSessions]
let events: DiagnosticsEventRecord[] = eventsList()

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
      browserQueryFloor: body.browserQueryFloor ?? 'BrowserQuery',
      minutes: body.minutes ?? 10,
    }
    overviewState = {
      ...overviewState,
      elevate: {
        active: true,
        browserQueryFloor: resp.browserQueryFloor,
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

  getHost: () => delay<Record<string, unknown>>(structuredClone(hostSample)),

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

  getSessionEvents: (connectionId: string, since?: string, namePrefix?: string) => {
    let filtered = events.filter((e) => e.connectionId === connectionId)
    if (since) filtered = filtered.filter((e) => e.utc >= since)
    if (namePrefix) filtered = filtered.filter((e) => e.name.startsWith(namePrefix))
    return delay<DiagnosticsEventRecord[]>(structuredClone(filtered))
  },

  listEvents: (params?: { since?: string; namePrefix?: string; connectionId?: string }) => {
    let filtered = [...events]
    if (params?.since) filtered = filtered.filter((e) => e.utc >= params.since!)
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
