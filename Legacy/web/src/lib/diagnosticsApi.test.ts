import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ API_URL: 'http://test-api', MOCK_MODE: false }))
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
      effectiveCapabilities: { MotorLive: { Metric: true, Event: true } },
      elevate: null,
      degraded: false,
      bytesUsed: 0,
      storageMaxBytes: 64 * 1024 * 1024,
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
    mockJson({ elevated: true, minutes: 15 })

    await diagnosticsApi.elevate({ minutes: 15 })
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/elevate`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ minutes: 15 }) }),
    )
  })

  it('getHost unwraps machine telemetry envelope', async () => {
    mockJson({ data: { hostname: 'motor-01', source: 'machine', cpuUsage: 42, cpuCount: 4, memoryAvailable: 100, diskTotalBytes: 200 }, redaction: 'none' })

    const host = await diagnosticsApi.getHost()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/host`, expect.any(Object))
    expect(host.cpuUsage).toBe(42)
    expect(host.source).toBe('machine')
    expect(host.cpuCount).toBe(4)
  })

  it('getApiProcess unwraps process and CLR telemetry envelope', async () => {
    mockJson({ data: { cpuUsage: 12, memoryUsed: 100, threadCount: 8, gcHeap: 50 }, redaction: 'none' })

    const apiProcess = await diagnosticsApi.getApiProcess()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/api-process`, expect.any(Object))
    expect(apiProcess.gcHeap).toBe(50)
  })

  it('getSampleHistory builds the paged query string', async () => {
    mockJson({ items: [], total: 0, nextCursor: null, bucketSeconds: 0, redaction: 'none' })

    await diagnosticsApi.getSampleHistory({ since: '2026-01-01T00:00:00Z', limit: 50, cursor: 'abc' })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url.startsWith(`${BASE}/telemetry/history?`)).toBe(true)
    expect(url).toContain('since=2026-01-01T00%3A00%3A00Z')
    expect(url).toContain('limit=50')
    expect(url).toContain('cursor=abc')
  })

  it('getSampleHistory forwards bucketSeconds for chart mode', async () => {
    mockJson({ items: [], total: 0, nextCursor: null, bucketSeconds: 300, redaction: 'none' })

    await diagnosticsApi.getSampleHistory({ bucketSeconds: 300 })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('bucketSeconds=300')
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

  it('getEventCatalog includes SessionResolved and UrlMapped', async () => {
    mockJson({
      diagnosticsSchemaVersion: 1,
      events: [
        'Motor.SessionStarted',
        'Motor.SessionResolved',
        'Motor.UrlMapped',
        'Diagnostics.ConfigApplied',
      ],
    })

    const catalog = await diagnosticsApi.getEventCatalog()
    expect(catalog.events).toContain('Motor.SessionResolved')
    expect(catalog.events).toContain('Motor.UrlMapped')
  })

  it('getSession unwraps { snapshot, redaction } envelope', async () => {
    mockJson({
      snapshot: { phase: 'Running', connectionId: 'c1', clientToken: 'tok' },
      redaction: 'none',
    })
    const snap = await diagnosticsApi.getSession('c1')
    expect(snap.phase).toBe('Running')
  })
})
