import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from './governanceDefaults'
import { diffDiagnosticsConfig } from './diffDiagnosticsConfig'

describe('diffDiagnosticsConfig', () => {
  it('returns empty when configs are equal', () => {
    expect(diffDiagnosticsConfig(DEFAULT_CONFIG, DEFAULT_CONFIG)).toEqual([])
  })

  it('diffs domain toggles, telemetry sections, sampling, probe, and elevate', () => {
    const pending = {
      ...DEFAULT_CONFIG,
      profile: 'Development' as const,
      domains: {
        ...DEFAULT_CONFIG.domains,
        sidecar: { metrics: true, events: false },
        browserQuery: { probe: true },
      },
      telemetry: {
        ...DEFAULT_CONFIG.telemetry,
        enabled: true,
        intervalSeconds: 10,
        motor: { ...DEFAULT_CONFIG.telemetry.motor, includePerSession: true },
        host: { ...DEFAULT_CONFIG.telemetry.host, enabled: false },
        apiProcess: { ...DEFAULT_CONFIG.telemetry.apiProcess, includeGc: !DEFAULT_CONFIG.telemetry.apiProcess.includeGc },
      },
      sampling: { statusMirrorRatio: 0.25, expensiveEventRatio: 0.1 },
      probe: { ...DEFAULT_CONFIG.probe, diagTimeoutMs: 20_000 },
      elevate: { browserQueryMaxMinutes: 60 },
      storage: { ...DEFAULT_CONFIG.storage, ttlHours: 48, maxBytes: 256 * 1024 * 1024 },
    }

    const changes = diffDiagnosticsConfig(DEFAULT_CONFIG, pending)
    const labels = changes.map((c) => c.label)

    expect(labels).toContain('Profile')
    expect(labels).toContain('Sidecar · Events')
    expect(labels).toContain('Browser Query · Probe')
    expect(labels).toContain('Telemetry interval')
    expect(labels).toContain('Telemetry · Machine')
    expect(labels).toContain('API process · GC')
    expect(labels).toContain('Motor · per-session')
    expect(labels).toContain('Status mirror ratio')
    expect(labels).toContain('Probe timeout')
    expect(labels).toContain('Elevate max minutes')
    expect(labels).toContain('Storage limit')
    expect(labels).toContain('TTL')

    const probe = changes.find((c) => c.label === 'Browser Query · Probe')
    expect(probe?.impact).toBe('up')
    const sidecarEvents = changes.find((c) => c.label === 'Sidecar · Events')
    expect(sidecarEvents?.impact).toBe('down')
  })
})
