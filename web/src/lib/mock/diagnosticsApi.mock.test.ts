import { beforeEach, describe, expect, it } from 'vitest'
import { mockDiagnosticsApi, _resetMockDiagnosticsApi } from './diagnosticsApi.mock'

describe('mockDiagnosticsApi', () => {
  beforeEach(() => {
    _resetMockDiagnosticsApi()
  })

  it('getOverview returns non-degraded overview with live sessions', async () => {
    const overview = await mockDiagnosticsApi.getOverview()
    expect(overview.diagnosticsSchemaVersion).toBe(1)
    expect(overview.enabled).toBe(true)
    expect(overview.degraded).toBe(false)
    expect(overview.liveSessions.total).toBeGreaterThan(0)
    expect(overview.needsAttention).toEqual([])
    expect(typeof overview.bytesUsed).toBe('number')
    expect(typeof overview.storageMaxBytes).toBe('number')
    expect(overview.effectiveCapabilities).toBeTruthy()
    expect(overview.effectiveCapabilities.MotorLive).toBeTruthy()
  })

  it('getRuntime returns typed snapshot', async () => {
    const runtime = await mockDiagnosticsApi.getRuntime()
    expect(runtime.diagnosticsSchemaVersion).toBe(1)
    expect(typeof runtime.eventsStored).toBe('number')
    expect(typeof runtime.redactionMode).toBe('string')
  })

  it('recover clears degraded state', async () => {
    const result = await mockDiagnosticsApi.recover()
    expect(result.recovered).toBe(true)
    expect(result.degraded).toBe(false)
    const overview = await mockDiagnosticsApi.getOverview()
    expect(overview.degraded).toBe(false)
  })

  it('elevate sets and clearElevate removes elevation', async () => {
    await mockDiagnosticsApi.elevate({ minutes: 15 })
    const after = await mockDiagnosticsApi.getOverview()
    expect(after.elevate).not.toBeNull()
    expect(after.elevate?.active).toBe(true)
    expect(after.elevate?.expiresUtc).toBeTruthy()

    await mockDiagnosticsApi.clearElevate()
    const cleared = await mockDiagnosticsApi.getOverview()
    expect(cleared.elevate).toBeNull()
  })

  it('listSessions returns sessions with activeCount', async () => {
    const result = await mockDiagnosticsApi.listSessions()
    expect(result.sessions.length).toBeGreaterThan(0)
    expect(result.activeCount + result.startingCount).toBe(result.sessions.length)
    const session = result.sessions[0]
    expect(session.connectionId).toBeTruthy()
    expect(session.phase).toBe('Running')
  })

  it('getSession returns full snapshot for connectionId', async () => {
    const list = await mockDiagnosticsApi.listSessions()
    const snap = await mockDiagnosticsApi.getSession(list.sessions[0].connectionId)
    expect(snap.connectionId).toBe(list.sessions[0].connectionId)
    expect(snap.phase).toBe('Running')
    expect(typeof snap.fps).toBe('number')
    expect(typeof snap.uptimeMs).toBe('number')
    expect(snap.sidecarConnected).toBe(true)
  })

  it('listEvents returns events and supports filtering', async () => {
    const all = await mockDiagnosticsApi.listEvents()
    expect(all.length).toBeGreaterThan(0)
    expect(all[0].id).toBeTruthy()
    expect(all[0].domain).toBeTruthy()

    const filtered = await mockDiagnosticsApi.listEvents({ namePrefix: 'Motor.' })
    expect(filtered.length).toBeLessThanOrEqual(all.length)
    for (const e of filtered) {
      expect(e.name.startsWith('Motor.')).toBe(true)
    }
  })

  it('getSessionEvents filters by connectionId', async () => {
    const list = await mockDiagnosticsApi.listSessions()
    const connId = list.sessions[0].connectionId
    const events = await mockDiagnosticsApi.getSessionEvents(connId)
    for (const e of events) {
      expect(e.connectionId).toBe(connId)
    }
  })

  it('runBrowserProbe returns structured result for ops', async () => {
    const list = await mockDiagnosticsApi.listSessions()
    const result = await mockDiagnosticsApi.runBrowserProbe(list.sessions[0].connectionId, {
      ops: ['process', 'cookies', 'resources'],
    })
    expect(result.ok).toBe(true)
    expect(result.correlationId).toBeTruthy()
    const data = result.data as Record<string, unknown>
    expect(data.process).toBeTruthy()
    expect(data.cookies).toBeTruthy()
    expect(data.resources).toBeTruthy()
  })

  it('getEventCatalog returns schema version and event names', async () => {
    const catalog = await mockDiagnosticsApi.getEventCatalog()
    expect(catalog.diagnosticsSchemaVersion).toBe(2)
    expect(catalog.events.length).toBeGreaterThan(0)
    expect(catalog.events).toContain('Motor.SessionStarted')
    expect(catalog.events).toContain('Diagnostics.ConfigApplied')
  })

  it('getHost returns host sample data', async () => {
    const host = await mockDiagnosticsApi.getHost()
    expect(host.hostname).toBeTruthy()
    expect(typeof host.cpuUsage).toBe('number')
    expect(typeof host.memoryUsed).toBe('number')
  })

  it('_resetMockDiagnosticsApi restores initial state', async () => {
    await mockDiagnosticsApi.elevate({ minutes: 5 })
    _resetMockDiagnosticsApi()
    const overview = await mockDiagnosticsApi.getOverview()
    expect(overview.elevate).toBeNull()
  })
})
