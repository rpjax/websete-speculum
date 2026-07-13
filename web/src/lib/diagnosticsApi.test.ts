import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ API_URL: 'http://test-api' }))
vi.mock('@/lib/auth', () => ({ getApiKey: () => 'test-key' }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { diagnosticsApi } from '@/lib/diagnosticsApi'

const BASE = 'http://test-api/api/admin/diagnostics/v1'

function mockJson(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })
}

describe('diagnosticsApi', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('getRuntime hits /runtime and returns schema version', async () => {
    mockJson({
      diagnosticsSchemaVersion: 1,
      enabled: true,
      effectiveLevels: { motorLive: 'Events' },
      elevate: null,
      degraded: false,
      bytesUsed: 0,
      eventsStored: 0,
      eventsDropped: 0,
      overflowCount: 0,
      probeInFlight: 0,
      lastCleanupUtc: null,
      redactionMode: 'none',
    })

    const snap = await diagnosticsApi.getRuntime()
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/runtime`,
      expect.objectContaining({
        credentials: 'include',
        headers: expect.any(Headers),
      }),
    )
    expect(snap.diagnosticsSchemaVersion).toBe(1)
    expect(typeof snap.overflowCount).toBe('number')
  })

  it('elevate PUTs /elevate', async () => {
    mockJson({ elevated: true, browserQueryFloor: 'BrowserQuery', minutes: 15 })

    await diagnosticsApi.elevate({ browserQueryFloor: 'BrowserQuery', minutes: 15 })
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/elevate`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ browserQueryFloor: 'BrowserQuery', minutes: 15 }) }),
    )
  })

  it('getHost unwraps { data } envelope', async () => {
    mockJson({ data: { utc: '2026-01-01T00:00:00Z', pid: 42 }, redaction: 'none' })

    const host = await diagnosticsApi.getHost()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/host`, expect.any(Object))
    expect(host.pid).toBe(42)
  })

  it('listEvents hits /events with namePrefix', async () => {
    mockJson([])
    await diagnosticsApi.listEvents({ namePrefix: 'Diagnostics.Elevate' })
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/events?namePrefix=Diagnostics.Elevate`,
      expect.any(Object),
    )
  })

  it('listSessions hits /sessions', async () => {
    mockJson({ activeCount: 0, startingCount: 0, sessions: [] })

    await diagnosticsApi.listSessions()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/sessions`, expect.any(Object))
  })

  it('getSessionEvents hits /sessions/{id}/events with since query', async () => {
    mockJson([{ diagnosticsSchemaVersion: 1, id: 'e1', utc: '2026-01-01T00:00:00Z', domain: 'MotorLive', name: 'Motor.SessionStarted', severity: 'Information', payload: {}, redaction: 'none' }])

    const events = await diagnosticsApi.getSessionEvents('conn-1', '2026-01-01T00:00:00Z')
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/sessions/conn-1/events?since=2026-01-01T00%3A00%3A00Z`,
      expect.any(Object),
    )
    expect(events[0]?.diagnosticsSchemaVersion).toBe(1)
  })

  it('runBrowserProbe POSTs /sessions/{id}/browser', async () => {
    mockJson({ ok: true, correlationId: 'c1', data: {}, redaction: 'none' })

    await diagnosticsApi.runBrowserProbe('conn-1', { ops: ['process'] })
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/sessions/conn-1/browser`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ops: ['process'] }) }),
    )
  })

  it('getEventCatalog hits /catalog/events with schema version', async () => {
    mockJson({ diagnosticsSchemaVersion: 1, events: ['Motor.SessionStarted'] })

    const catalog = await diagnosticsApi.getEventCatalog()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/catalog/events`, expect.any(Object))
    expect(catalog.diagnosticsSchemaVersion).toBe(1)
    expect(catalog.events).toContain('Motor.SessionStarted')
  })

  it('listPersisted hits /persisted', async () => {
    mockJson([])

    await diagnosticsApi.listPersisted()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/persisted`, expect.any(Object))
  })
})
