import { describe, expect, it } from 'vitest'
import {
  detectStoryType,
  formatBytes,
  formatDuration,
  formatRelativeTime,
  DOMAIN_COLORS,
  DOMAIN_BG,
  DOMAIN_LABELS,
  LEVEL_DESCRIPTIONS,
  STORY_TYPES,
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
})

describe('constants completeness', () => {
  it('has colors for all domains', () => {
    const domains = ['Motor.Live', 'Sidecar.Browser', 'BrowserQuery', 'Persistence', 'HostResources', 'Diagnostics.Self']
    for (const d of domains) {
      expect(DOMAIN_COLORS[d]).toBeDefined()
      expect(DOMAIN_BG[d]).toBeDefined()
      expect(DOMAIN_LABELS[d]).toBeDefined()
    }
  })

  it('has descriptions for all levels', () => {
    const levels = ['Off', 'Metrics', 'Events', 'StateSnapshots', 'BrowserQuery']
    for (const l of levels) {
      expect(LEVEL_DESCRIPTIONS[l]).toBeDefined()
    }
  })

  it('story types cover expected categories', () => {
    const expected = ['session-lifecycle', 'navigation', 'probe', 'drain', 'state-export', 'admin', 'unknown']
    expect(Object.keys(STORY_TYPES)).toEqual(expect.arrayContaining(expected))
  })
})
