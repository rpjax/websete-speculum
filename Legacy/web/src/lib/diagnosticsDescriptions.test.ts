import { describe, it, expect } from 'vitest'
import {
  describeEvent,
  describeErrorCode,
  describePhase,
  humanizeConnectionId,
  humanizeDomain,
  narrateStory,
} from './diagnosticsDescriptions'
import type { CorrelationStory } from '@/lib/hooks/useCorrelationStories'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

function makeEvent(overrides: Partial<DiagnosticsEventRecord> = {}): DiagnosticsEventRecord {
  return {
    diagnosticsSchemaVersion: 1,
    id: 'evt-1',
    utc: '2025-01-01T00:00:00Z',
    domain: 'MotorLive',
    name: 'Motor.SessionStarted',
    severity: 'Info',
    redaction: 'None',
    payload: null,
    connectionId: 'conn-1',
    correlationId: 'corr-1',
    ...overrides,
  }
}

describe('describeEvent', () => {
  it('returns known description for catalogued events', () => {
    const desc = describeEvent('Motor.SessionStarted')
    expect(desc).toContain('Session startup completed')
  })

  it('returns fallback for unknown events', () => {
    expect(describeEvent('Custom.Unknown')).toBe('Diagnostic event: Custom.Unknown')
  })

  it('covers all Motor events', () => {
    const motorEvents = [
      'Motor.SessionStarting', 'Motor.SessionResolved', 'Motor.SlotAcquired',
      'Motor.SidecarConnected', 'Motor.SessionPromoted', 'Motor.SessionStarted',
      'Motor.SessionStopped', 'Motor.SessionFailed',
    ]
    for (const name of motorEvents) {
      expect(describeEvent(name)).not.toContain('Diagnostic event:')
    }
  })
})

describe('describeErrorCode', () => {
  it('returns structured explanation for known codes', () => {
    const result = describeErrorCode('navigate_blocked_by_allowlist')
    expect(result.summary).toBe('URL blocked by allowlist')
    expect(result.detail).toContain('allowed domain list')
    expect(result.action).toBeDefined()
  })

  it('returns humanized fallback for unknown codes', () => {
    const result = describeErrorCode('some_custom_error')
    expect(result.summary).toBe('some custom error')
    expect(result.detail).toBe('Error code: some_custom_error')
  })
})

describe('describePhase', () => {
  it('returns description for known phases', () => {
    expect(describePhase('Running')).toContain('live')
    expect(describePhase('Starting')).toContain('prepared')
  })

  it('returns raw phase for unknown values', () => {
    expect(describePhase('CustomPhase')).toBe('CustomPhase')
  })
})

describe('humanizeConnectionId', () => {
  it('extracts uppercase segment from connection ID', () => {
    expect(humanizeConnectionId('conn-aaaa-1111-2222-3333')).toBe('Session AAAA-111')
  })

  it('returns System for null', () => {
    expect(humanizeConnectionId(null)).toBe('System')
  })
})

describe('humanizeDomain', () => {
  it('returns human description for known domains', () => {
    expect(humanizeDomain('MotorLive')).toContain('Session lifecycle')
    expect(humanizeDomain('SidecarBrowser')).toContain('Browser process')
    expect(humanizeDomain('Telemetry')).toContain('Composite')
  })

  it('returns raw domain for unknown values', () => {
    expect(humanizeDomain('Custom.Domain')).toBe('Custom.Domain')
  })
})

describe('narrateStory', () => {
  function makeStory(type: CorrelationStory['type'], events: Partial<DiagnosticsEventRecord>[]): CorrelationStory {
    const fullEvents = events.map((e, i) => makeEvent({ id: `evt-${i}`, ...e }))
    const times = fullEvents.map((e) => new Date(e.utc).getTime())
    return {
      type,
      correlationId: 'corr-test',
      connectionId: fullEvents[0].connectionId ?? null,
      events: fullEvents,
      earliestUtc: fullEvents[0].utc,
      latestUtc: fullEvents[fullEvents.length - 1].utc,
      durationMs: Math.max(...times) - Math.min(...times),
    }
  }

  it('narrates a successful session lifecycle', () => {
    const story = makeStory('session-lifecycle', [
      { name: 'Motor.SessionStarting' },
      { name: 'Motor.SessionStarted' },
    ])
    expect(narrateStory(story)).toContain('new remote browser session')
  })

  it('narrates a failed session lifecycle with error code', () => {
    const story = makeStory('session-lifecycle', [
      { name: 'Motor.SessionStarting' },
      { name: 'Motor.SessionFailed', severity: 'Error', payload: { errorCode: 'session_slot_exhausted' } },
    ])
    const result = narrateStory(story)
    expect(result).toContain('failed')
    expect(result).toContain('No browser slots available')
  })

  it('narrates a restored session', () => {
    const story = makeStory('session-lifecycle', [
      { name: 'Motor.SessionStarting', payload: { restored: true, cookieCount: 5 } },
      { name: 'Motor.SessionStarted' },
    ])
    expect(narrateStory(story)).toContain('restored')
    expect(narrateStory(story)).toContain('5 cookies')
  })

  it('narrates a successful navigation', () => {
    const story = makeStory('navigation', [
      { name: 'Motor.NavigateRequested', payload: { targetUrl: 'https://example.com' } },
      { name: 'Motor.NavigateCompleted' },
    ])
    expect(narrateStory(story)).toContain('https://example.com')
    expect(narrateStory(story)).toContain('loaded successfully')
  })

  it('narrates a blocked navigation', () => {
    const story = makeStory('navigation', [
      { name: 'Motor.NavigateRejected', severity: 'Error', payload: { errorCode: 'navigate_blocked_by_allowlist' } },
    ])
    expect(narrateStory(story)).toContain('blocked')
  })

  it('narrates a probe', () => {
    const story = makeStory('probe', [
      { name: 'Sidecar.DiagProbeRequested', payload: { ops: ['cookies', 'tabs'] } },
      { name: 'Sidecar.DiagProbeCompleted' },
    ])
    expect(narrateStory(story)).toContain('cookies, tabs')
  })

  it('narrates a drain', () => {
    const story = makeStory('drain', [
      { name: 'Motor.DrainStarted', payload: { sessionCount: 3, sectionKey: 'Hosting' } },
      { name: 'Motor.DrainCompleted' },
    ])
    const result = narrateStory(story)
    expect(result).toContain('Hosting')
    expect(result).toContain('3 session(s)')
  })

  it('narrates a state export', () => {
    const story = makeStory('state-export', [
      { name: 'Motor.StateExportCompleted', payload: { cookieCount: 10, localStorageCount: 3 } },
    ])
    const result = narrateStory(story)
    expect(result).toContain('10 cookies')
    expect(result).toContain('3 localStorage')
  })

  it('narrates admin elevation', () => {
    const story = makeStory('admin', [
      { name: 'Diagnostics.ElevateStarted', payload: { minutes: 15 } },
    ])
    expect(narrateStory(story)).toContain('Browser Query')
    expect(narrateStory(story)).toContain('15 minutes')
  })

  it('returns generic message for unknown type', () => {
    const story = makeStory('unknown' as CorrelationStory['type'], [
      { name: 'Custom.Event' },
    ])
    expect(narrateStory(story)).toContain('1 diagnostic event(s)')
  })
})
