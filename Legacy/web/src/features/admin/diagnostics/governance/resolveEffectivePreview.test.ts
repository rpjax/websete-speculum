import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from './governanceDefaults'
import {
  applyRuntimeOverlays,
  explainMismatch,
  isCapabilityEffectivelyOn,
  resolveConfiguredCapabilities,
  resolveEffectivePreview,
} from './resolveEffectivePreview'

describe('resolveEffectivePreview', () => {
  it('maps domain toggles and telemetry master into configured capabilities', () => {
    const caps = resolveConfiguredCapabilities(DEFAULT_CONFIG)
    expect(caps.MotorLive?.Metric).toBe(true)
    expect(caps.SidecarBrowser?.Event).toBe(true)
    expect(caps.BrowserQuery?.Probe).toBe(false)
    expect(caps.Telemetry?.Metric).toBe(DEFAULT_CONFIG.telemetry.enabled)
    expect(caps.DiagnosticsSelf?.Metric).toBe(true)
  })

  it('disables everything when pipeline is off', () => {
    const caps = resolveConfiguredCapabilities({ ...DEFAULT_CONFIG, enabled: false })
    expect(caps.DiagnosticsSelf?.Metric).toBe(false)
    expect(caps.MotorLive?.Metric).toBe(false)
  })

  it('caps non-Metric capabilities when degraded', () => {
    const base = resolveConfiguredCapabilities({
      ...DEFAULT_CONFIG,
      domains: {
        motor: { metrics: true, events: true, snapshots: true },
        sidecar: { metrics: true, events: true },
        browserQuery: { probe: true },
        persisted: { snapshots: true },
      },
    })
    const degraded = applyRuntimeOverlays(base, { degraded: true, elevateActive: false })
    expect(degraded.MotorLive?.Metric).toBe(true)
    expect(degraded.MotorLive?.Event).toBe(false)
    expect(degraded.BrowserQuery?.Probe).toBe(false)
  })

  it('elevate forces BrowserQuery Probe and Sidecar events even when config is off', () => {
    const preview = resolveEffectivePreview(DEFAULT_CONFIG, {
      degraded: false,
      elevateActive: true,
    })
    expect(preview.BrowserQuery?.Probe).toBe(true)
    expect(preview.SidecarBrowser?.Event).toBe(true)
  })

  it('elevate overrides degraded for BrowserQuery and Sidecar', () => {
    const preview = resolveEffectivePreview(
      {
        ...DEFAULT_CONFIG,
        domains: {
          ...DEFAULT_CONFIG.domains,
          browserQuery: { probe: false },
          sidecar: { metrics: false, events: false },
        },
      },
      { degraded: true, elevateActive: true },
    )
    expect(preview.BrowserQuery?.Probe).toBe(true)
    expect(preview.SidecarBrowser?.Event).toBe(true)
    expect(preview.MotorLive?.Event).toBe(false)
  })

  it('isCapabilityEffectivelyOn reads the effective map', () => {
    const preview = resolveEffectivePreview(DEFAULT_CONFIG, {
      degraded: false,
      elevateActive: false,
    })
    expect(isCapabilityEffectivelyOn(preview, 'MotorLive', 'Metric')).toBe(true)
    expect(isCapabilityEffectivelyOn(preview, 'BrowserQuery', 'Probe')).toBe(false)
  })

  it('explainMismatch distinguishes degraded vs elevate', () => {
    expect(explainMismatch(true, false, { degraded: true, elevateActive: false })).toBe('degraded')
    expect(explainMismatch(false, true, { degraded: false, elevateActive: true })).toBe('elevate')
    expect(explainMismatch(true, true, { degraded: false, elevateActive: false })).toBe(null)
  })
})
