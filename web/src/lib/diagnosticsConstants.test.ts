import { describe, expect, it } from 'vitest'
import {
  detectStoryType,
  formatBytes,
  formatDuration,
  formatRelativeTime,
  DOMAIN_COLORS,
  DOMAIN_BG,
  DOMAIN_LABELS,
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_ORDER,
  EVENT_DOMAINS,
  STORY_TYPES,
  DIAGNOSTICS_PRESETS,
  summarizeCapabilities,
  countCapabilities,
} from './diagnosticsConstants'

describe('detectStoryType', () => {
  it('detects session-lifecycle', () => {
    expect(detectStoryType(['Motor.SessionStarting', 'Motor.SessionStarted'])).toBe('session-lifecycle')
  })

  it('detects navigation', () => {
    expect(detectStoryType(['Motor.NavigateRequested', 'Motor.NavigateCompleted'])).toBe('navigation')
  })

  it('detects probe', () => {
    expect(detectStoryType(['Sidecar.DiagProbeRequested', 'Sidecar.DiagProbeCompleted'])).toBe('probe')
  })

  it('detects drain', () => {
    expect(detectStoryType(['Motor.DrainStarted', 'Motor.DrainCompleted'])).toBe('drain')
  })

  it('detects state-export', () => {
    expect(detectStoryType(['Motor.StateExportStarted', 'Motor.StateExportCompleted'])).toBe('state-export')
  })

  it('detects admin', () => {
    expect(detectStoryType(['Diagnostics.ElevateStarted', 'Diagnostics.ConfigApplied'])).toBe('admin')
  })

  it('returns unknown for unrecognized events', () => {
    expect(detectStoryType(['Custom.Unknown'])).toBe('unknown')
  })

  it('returns unknown for empty list', () => {
    expect(detectStoryType([])).toBe('unknown')
  })
})

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats bytes under 1KB', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('formats KB', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats MB', () => {
    expect(formatBytes(12_582_912)).toBe('12 MB')
  })

  it('formats GB', () => {
    expect(formatBytes(2_147_483_648)).toBe('2.0 GB')
  })
})

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms')
  })

  it('formats seconds', () => {
    expect(formatDuration(5000)).toBe('5s')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(125_000)).toBe('2m 5s')
  })

  it('formats hours', () => {
    expect(formatDuration(7_200_000)).toBe('2h')
  })
})

describe('formatRelativeTime', () => {
  it('formats just now for future times', () => {
    const future = new Date(Date.now() + 10_000).toISOString()
    expect(formatRelativeTime(future)).toBe('just now')
  })

  it('formats seconds ago', () => {
    const recent = new Date(Date.now() - 30_000).toISOString()
    expect(formatRelativeTime(recent)).toBe('30s ago')
  })

  it('formats minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 300_000).toISOString()
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago')
  })

  it('returns em dash for missing or invalid timestamps', () => {
    expect(formatRelativeTime(undefined)).toBe('—')
    expect(formatRelativeTime(null)).toBe('—')
    expect(formatRelativeTime('')).toBe('—')
    expect(formatRelativeTime('not-a-date')).toBe('—')
  })
})

describe('constants completeness', () => {
  it('has colors for all domains', () => {
    for (const d of EVENT_DOMAINS) {
      expect(DOMAIN_COLORS[d]).toBeDefined()
      expect(DOMAIN_BG[d]).toBeDefined()
      expect(DOMAIN_LABELS[d]).toBeDefined()
    }
  })

  it('has descriptions for all capabilities', () => {
    for (const c of CAPABILITY_ORDER) {
      expect(CAPABILITY_DESCRIPTIONS[c]).toBeDefined()
    }
  })

  it('story types cover expected categories', () => {
    const expected = ['session-lifecycle', 'navigation', 'probe', 'drain', 'state-export', 'admin', 'unknown']
    expect(Object.keys(STORY_TYPES)).toEqual(expect.arrayContaining(expected))
  })
})

describe('capability helpers', () => {
  it('summarizeCapabilities lists enabled capabilities and flags off', () => {
    expect(summarizeCapabilities({ Metric: true, Event: false })).toEqual({ enabled: ['Metric'], off: false })
    expect(summarizeCapabilities({ Probe: false })).toEqual({ enabled: [], off: true })
    expect(summarizeCapabilities(undefined)).toEqual({ enabled: [], off: true })
  })

  it('countCapabilities tallies on/off across domains', () => {
    const eff = {
      MotorLive: { Metric: true, Event: true, Snapshot: false },
      BrowserQuery: { Probe: false },
    }
    expect(countCapabilities(eff)).toEqual({ off: 2, total: 4, enabled: 2 })
    expect(countCapabilities(undefined)).toEqual({ off: 0, total: 0, enabled: 0 })
  })
})

describe('diagnostics presets', () => {
  it('define domain + telemetry toggle bundles for every profile', () => {
    for (const profile of ['Development', 'Production', 'Assertive'] as const) {
      const preset = DIAGNOSTICS_PRESETS[profile]
      expect(preset.domains.motor).toBeDefined()
      expect(preset.domains.browserQuery).toBeDefined()
      expect(preset.telemetry.enabled).toBe(true)
      expect(typeof preset.telemetry.intervalSeconds).toBe('number')
    }
  })

  it('keeps Browser Query probe off in Production but on in Development', () => {
    expect(DIAGNOSTICS_PRESETS.Production.domains.browserQuery.probe).toBe(false)
    expect(DIAGNOSTICS_PRESETS.Development.domains.browserQuery.probe).toBe(true)
  })

  it('Production keeps operable evidence without per-session telemetry fan-out', () => {
    const p = DIAGNOSTICS_PRESETS.Production
    expect(p.domains.sidecar.events).toBe(true)
    expect(p.telemetry.motor.includeSessionIds).toBe(true)
    expect(p.telemetry.motor.includeUrlHost).toBe(true)
    expect(p.telemetry.motor.includePerSession).toBe(false)
    expect(p.telemetry.pipeline.includeBreakerPressure).toBe(true)
    expect(p.telemetry.sidecar.includeFaultedIds).toBe(true)
    expect(p.storage.maxBytes).toBe(16 * 1024 * 1024 * 1024)
    expect(p.storage.ttlHours).toBe(30 * 24)
    expect(p.storage.maxEventsPerSession).toBe(50_000)
    expect(p.sampling.statusMirrorRatio).toBe(0.5)
  })
})
