import { describe, expect, it } from 'vitest'
import {
  TELEMETRY_PRESETS,
  applyTelemetryPreset,
  clampIntervalSeconds,
  describeSectionDetail,
  samplesPerHour,
  sectionEnabled,
  setAllSections,
  summarizeTelemetry,
} from './telemetryHelpers'

describe('telemetryHelpers', () => {
  it('clamps interval and estimates samples/hour', () => {
    expect(clampIntervalSeconds(0)).toBe(1)
    expect(clampIntervalSeconds(9999)).toBe(3600)
    expect(samplesPerHour(30)).toBe(120)
  })

  it('summarizes sampler posture', () => {
    const summary = summarizeTelemetry({
      isEnabled: true,
      intervalSeconds: 30,
      host: { isEnabled: true },
      apiProcess: { isEnabled: true },
      sessions: { isEnabled: false },
      sidecar: { isEnabled: true },
      profiles: { isEnabled: true },
      journal: { isEnabled: true },
      docker: { isEnabled: false },
    })
    expect(summary.enabled).toBe(true)
    expect(summary.activeSectionCount).toBe(5)
    expect(summary.statusLabel).toContain('Sampler on')
  })

  it('applies presets without wiping events', () => {
    const current = {
      isEnabled: false,
      events: { 'Telemetry.Sessions.Input.WebTransportReceived': true },
      host: { isEnabled: false, procPath: '/custom' },
    }
    const lean = TELEMETRY_PRESETS.find((preset) => preset.id === 'lean')!
    const next = applyTelemetryPreset(current, lean)
    expect(next.isEnabled).toBe(true)
    expect(next.intervalSeconds).toBe(60)
    expect(next.events).toEqual(current.events)
    expect(asHost(next).procPath).toBe('/proc')
  })

  it('keeps section prefs when turning sampler off', () => {
    const off = TELEMETRY_PRESETS.find((preset) => preset.id === 'off')!
    const next = applyTelemetryPreset(
      { isEnabled: true, host: { isEnabled: true }, intervalSeconds: 15 },
      off,
    )
    expect(next.isEnabled).toBe(false)
    expect(next.intervalSeconds).toBe(15)
    expect(sectionEnabled(next, 'host')).toBe(true)
  })

  it('toggles all sections and describes detail', () => {
    const allOff = setAllSections({ host: { isEnabled: true } }, false)
    expect(sectionEnabled(allOff, 'host')).toBe(false)
    expect(sectionEnabled(allOff, 'docker')).toBe(false)
    expect(
      describeSectionDetail(
        { sessions: { includeSessionIds: true, includeUrlHost: true, includePerSession: false } },
        'sessions',
      ),
    ).toContain('ids')
  })
})

function asHost(value: Record<string, unknown>) {
  return value.host as { procPath?: string }
}
