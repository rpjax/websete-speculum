import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      getStatus: vi.fn(),
      getSection: vi.fn(),
      listSessions: vi.fn(),
      listScripts: vi.fn(),
    },
  }
})

vi.mock('@/lib/diagnosticsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/diagnosticsApi')>()
  return {
    ...actual,
    diagnosticsApi: {
      getOverview: vi.fn(),
      listSessions: vi.fn(),
      listEvents: vi.fn(),
    },
  }
})

import { useMotorOverview } from './useMotorOverview'
import { api } from '@/lib/api'
import { diagnosticsApi, type DiagnosticsOverview, type DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { computeHealthScore } from '@/components/admin/HealthScoreGauge'
import { countCapabilities } from '@/lib/diagnosticsConstants'

function overview(o: Partial<DiagnosticsOverview> = {}): DiagnosticsOverview {
  return {
    diagnosticsSchemaVersion: 1,
    enabled: true,
    degraded: false,
    elevate: null,
    bytesUsed: 0,
    storageMaxBytes: 64 * 1024 * 1024,
    eventsStored: 0,
    eventsDropped: 0,
    overflowCount: 0,
    probeInFlight: 0,
    lastCleanupUtc: null,
    redactionMode: 'Safe',
    effectiveCapabilities: {},
    liveSessions: { activeCount: 0, startingCount: 0, total: 0 },
    needsAttention: [],
    ...o,
  }
}

function event(id: string): DiagnosticsEventRecord {
  return {
    diagnosticsSchemaVersion: 1,
    id,
    utc: new Date(Date.UTC(2026, 0, 1) + Number(id) * 1000).toISOString(),
    domain: 'MotorLive',
    name: 'Motor.SessionStarted',
    severity: 'Info',
    payload: null,
    redaction: 'None',
  }
}

function setSections(values: Record<string, unknown>) {
  vi.mocked(api.getSection).mockImplementation(
    ((section: string) => Promise.resolve(section in values ? values[section] : null)) as unknown as typeof api.getSection,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getStatus).mockResolvedValue({ operational: true, missing: [] })
  vi.mocked(api.listSessions).mockResolvedValue([])
  vi.mocked(api.listScripts).mockResolvedValue([])
  setSections({})
  vi.mocked(diagnosticsApi.getOverview).mockResolvedValue(overview())
  vi.mocked(diagnosticsApi.listSessions).mockResolvedValue({ activeCount: 0, startingCount: 0, sessions: [] })
  vi.mocked(diagnosticsApi.listEvents).mockResolvedValue([])
})

async function renderLoaded() {
  const hook = renderHook(() => useMotorOverview())
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

describe('useMotorOverview', () => {
  it('derives storagePercent from the dynamic storageMaxBytes field', async () => {
    vi.mocked(diagnosticsApi.getOverview).mockResolvedValue(
      overview({ bytesUsed: 32 * 1024 * 1024, storageMaxBytes: 64 * 1024 * 1024 }),
    )
    const { result } = await renderLoaded()
    expect(result.current.storagePercent).toBeCloseTo(50)
  })

  it('reports 0 storagePercent when storageMaxBytes is 0', async () => {
    vi.mocked(diagnosticsApi.getOverview).mockResolvedValue(
      overview({ bytesUsed: 10_000, storageMaxBytes: 0 }),
    )
    const { result } = await renderLoaded()
    expect(result.current.storagePercent).toBe(0)
  })

  it('sets error but keeps other data when getStatus rejects', async () => {
    vi.mocked(api.getStatus).mockRejectedValue(new Error('boom'))
    const { result } = await renderLoaded()
    expect(result.current.error).toBe('Failed to load system status')
    expect(result.current.status).toBeNull()
    expect(result.current.diagnostics).not.toBeNull()
  })

  it('keeps only the last 8 events, most-recent first', async () => {
    const events = Array.from({ length: 10 }, (_, i) => event(String(i)))
    vi.mocked(diagnosticsApi.listEvents).mockResolvedValue(events)
    const { result } = await renderLoaded()
    expect(result.current.recentEvents.map((e) => e.id)).toEqual(
      ['9', '8', '7', '6', '5', '4', '3', '2'],
    )
  })

  it('counts configured sections including diagnostics.enabled', async () => {
    setSections({
      Forwarding: { host: 'edge.example.com', domains: ['a.com'] },
      MaxSessions: 10,
      SessionPolicy: { ttlDays: 7 },
      JsBridge: { enable: true },
      Hosting: { acmeEmail: 'a@b.c', profiles: [{ domain: 'a.com', subdomainMirroringEnabled: false }] },
      ScriptInjection: [{ position: 'HeaderTop', type: 'Classic' }],
    })
    vi.mocked(api.listScripts).mockResolvedValue([{}] as never)
    vi.mocked(diagnosticsApi.getOverview).mockResolvedValue(overview({ enabled: true }))

    const { result } = await renderLoaded()
    expect(result.current.configuredCount).toBe(8)
  })

  it('drops the diagnostics contribution from configuredCount when disabled', async () => {
    setSections({
      Forwarding: { host: 'edge.example.com', domains: ['a.com'] },
      MaxSessions: 10,
      SessionPolicy: { ttlDays: 7 },
      JsBridge: { enable: true },
      Hosting: { acmeEmail: 'a@b.c', profiles: [{ domain: 'a.com', subdomainMirroringEnabled: false }] },
      ScriptInjection: [{ position: 'HeaderTop', type: 'Classic' }],
    })
    vi.mocked(api.listScripts).mockResolvedValue([{}] as never)
    vi.mocked(diagnosticsApi.getOverview).mockResolvedValue(overview({ enabled: false }))

    const { result } = await renderLoaded()
    expect(result.current.configuredCount).toBe(7)
  })

  it('delegates healthScore to computeHealthScore with countCapabilities inputs', async () => {
    const ov = overview({
      degraded: true,
      eventsDropped: 3,
      overflowCount: 1,
      bytesUsed: 32 * 1024 * 1024,
      storageMaxBytes: 64 * 1024 * 1024,
      liveSessions: { activeCount: 4, startingCount: 0, total: 4 },
      effectiveCapabilities: {
        MotorLive: { Metric: true, Event: false, Snapshot: true },
        SidecarBrowser: { Metric: true, Event: false },
      },
    })
    vi.mocked(diagnosticsApi.getOverview).mockResolvedValue(ov)

    const { result } = await renderLoaded()

    const { off, total } = countCapabilities(ov.effectiveCapabilities)
    const expected = computeHealthScore({
      degraded: ov.degraded,
      eventsDropped: ov.eventsDropped,
      overflowCount: ov.overflowCount,
      liveSessions: ov.liveSessions.activeCount,
      storagePercent: (ov.bytesUsed / ov.storageMaxBytes) * 100,
      capabilitiesOff: off,
      totalCapabilities: total || 1,
    })

    expect(result.current.healthScore).toBe(expected)
  })
})
