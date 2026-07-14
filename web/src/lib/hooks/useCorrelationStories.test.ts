import { describe, expect, it } from 'vitest'
import { groupEventsIntoStories, groupEventsBySession, extractStorySummary, type CorrelationStory } from './useCorrelationStories'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

function makeEvent(overrides: Partial<DiagnosticsEventRecord> = {}): DiagnosticsEventRecord {
  return {
    diagnosticsSchemaVersion: 1,
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    utc: new Date().toISOString(),
    domain: 'Motor.Live',
    name: 'Motor.SessionStarted',
    severity: 'Info',
    correlationId: null,
    connectionId: null,
    persistedSessionId: null,
    sidecarSessionId: null,
    payload: {},
    redaction: 'none',
    ...overrides,
  }
}

describe('groupEventsIntoStories', () => {
  it('groups events by correlationId', () => {
    const events = [
      makeEvent({ correlationId: 'corr-1', name: 'Motor.SessionStarting', utc: '2026-01-01T00:00:00Z' }),
      makeEvent({ correlationId: 'corr-1', name: 'Motor.SessionStarted', utc: '2026-01-01T00:00:01Z' }),
      makeEvent({ correlationId: 'corr-2', name: 'Motor.NavigateRequested', utc: '2026-01-01T00:01:00Z' }),
    ]
    const { stories, uncorrelated } = groupEventsIntoStories(events)
    expect(stories).toHaveLength(2)
    expect(uncorrelated).toHaveLength(0)
    expect(stories.find((s) => s.correlationId === 'corr-1')?.events).toHaveLength(2)
  })

  it('puts events without correlationId into uncorrelated', () => {
    const events = [
      makeEvent({ correlationId: null }),
      makeEvent({ correlationId: 'corr-1' }),
    ]
    const { stories, uncorrelated } = groupEventsIntoStories(events)
    expect(stories).toHaveLength(1)
    expect(uncorrelated).toHaveLength(1)
  })

  it('detects story type correctly', () => {
    const events = [
      makeEvent({ correlationId: 'corr-nav', name: 'Motor.NavigateRequested' }),
      makeEvent({ correlationId: 'corr-nav', name: 'Motor.NavigateCompleted' }),
    ]
    const { stories } = groupEventsIntoStories(events)
    expect(stories[0].type).toBe('navigation')
  })

  it('calculates duration from first to last event', () => {
    const events = [
      makeEvent({ correlationId: 'c1', utc: '2026-01-01T00:00:00.000Z' }),
      makeEvent({ correlationId: 'c1', utc: '2026-01-01T00:00:01.500Z' }),
    ]
    const { stories } = groupEventsIntoStories(events)
    expect(stories[0].durationMs).toBe(1500)
  })

  it('sorts stories by latest event descending', () => {
    const events = [
      makeEvent({ correlationId: 'old', utc: '2026-01-01T00:00:00Z' }),
      makeEvent({ correlationId: 'new', utc: '2026-01-01T01:00:00Z' }),
    ]
    const { stories } = groupEventsIntoStories(events)
    expect(stories[0].correlationId).toBe('new')
  })
})

describe('groupEventsBySession', () => {
  it('groups events by connectionId', () => {
    const events = [
      makeEvent({ connectionId: 'conn-1' }),
      makeEvent({ connectionId: 'conn-1' }),
      makeEvent({ connectionId: 'conn-2' }),
      makeEvent({ connectionId: null }),
    ]
    const groups = groupEventsBySession(events)
    expect(groups).toHaveLength(3)
    const conn1Group = groups.find((g) => g.connectionId === 'conn-1')
    expect(conn1Group?.events).toHaveLength(2)
  })

  it('puts system events (null connectionId) last', () => {
    const events = [
      makeEvent({ connectionId: null, utc: '2026-01-01T02:00:00Z' }),
      makeEvent({ connectionId: 'conn-1', utc: '2026-01-01T00:00:00Z' }),
    ]
    const groups = groupEventsBySession(events)
    expect(groups[groups.length - 1].connectionId).toBeNull()
  })

  it('creates stories within each session group', () => {
    const events = [
      makeEvent({ connectionId: 'conn-1', correlationId: 'corr-1' }),
      makeEvent({ connectionId: 'conn-1', correlationId: 'corr-1' }),
      makeEvent({ connectionId: 'conn-1', correlationId: null }),
    ]
    const groups = groupEventsBySession(events)
    expect(groups[0].stories).toHaveLength(1)
    expect(groups[0].uncorrelated).toHaveLength(1)
  })
})

describe('extractStorySummary', () => {
  function makeStory(overrides: Partial<CorrelationStory> = {}): CorrelationStory {
    return {
      correlationId: 'corr-test',
      type: 'unknown',
      events: [],
      connectionId: null,
      latestUtc: new Date().toISOString(),
      earliestUtc: new Date().toISOString(),
      durationMs: 0,
      ...overrides,
    }
  }

  it('extracts session lifecycle summary', () => {
    const story = makeStory({
      type: 'session-lifecycle',
      durationMs: 1200,
      events: [
        makeEvent({ name: 'Motor.SessionStarted', payload: { restored: true, cookieCount: 12, persistedSessionId: 'sess-abcdef123456' } }),
      ],
    })
    const summary = extractStorySummary(story)
    expect(summary['Restored']).toBe('yes')
    expect(summary['Cookies']).toBe('12')
    expect(summary['Session']).toContain('sess-abcdef1')
  })

  it('extracts navigation summary', () => {
    const story = makeStory({
      type: 'navigation',
      durationMs: 350,
      events: [
        makeEvent({ name: 'Motor.NavigateRequested', payload: { targetUrl: 'https://example.com' } }),
      ],
    })
    const summary = extractStorySummary(story)
    expect(summary['URL']).toBe('https://example.com')
  })

  it('extracts probe summary', () => {
    const story = makeStory({
      type: 'probe',
      durationMs: 100,
      events: [
        makeEvent({ name: 'Sidecar.DiagProbeRequested', payload: { ops: ['process', 'tabs'] } }),
      ],
    })
    const summary = extractStorySummary(story)
    expect(summary['Ops']).toBe('process, tabs')
  })

  it('includes duration for non-zero durations', () => {
    const story = makeStory({ durationMs: 2500 })
    const summary = extractStorySummary(story)
    expect(summary['Duration']).toBe('2.5s')
  })
})
