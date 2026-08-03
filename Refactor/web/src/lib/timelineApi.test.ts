import { describe, expect, it } from 'vitest'
import { journalToNarrativeEvent, type TimelineEvent } from './timelineApi'

function sample(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    sequence: 42,
    publishedAt: '2026-08-02T22:00:00.000Z',
    type: 'Telemetry.Sampling.SampleCollected',
    schemaVersion: 1,
    publishPolicy: 'BestEffort',
    indexKeys: {},
    payload: { cpu: 0.2 },
    ...overrides,
  }
}

describe('journalToNarrativeEvent', () => {
  it('maps Journal facts into narrative envelope fields', () => {
    const evt = journalToNarrativeEvent(sample())
    expect(evt.name).toBe('Telemetry.Sampling.SampleCollected')
    expect(evt.domain).toBe('Telemetry')
    expect(evt.seq).toBe(42)
    expect(evt.severity).toBe('Metric')
    expect(evt.correlationId).toBe('type:Telemetry.Sampling.SampleCollected')
    expect(evt.connectionId).toBeNull()
  })

  it('binds session index keys to connectionId for lane grouping', () => {
    const evt = journalToNarrativeEvent(
      sample({
        type: 'Sessions.Lifecycle.Started',
        indexKeys: { session: 'sess-abc' },
        publishPolicy: 'Reliable',
      }),
    )
    expect(evt.connectionId).toBe('sess-abc')
    expect(evt.correlationId).toBeNull()
    expect(evt.severity).toBe('Info')
    expect(evt.redaction).toBe('none')
  })

  it('maps SessionTimedOut as Info lifecycle, not Error', () => {
    const evt = journalToNarrativeEvent(
      sample({
        type: 'Sessions.SessionTimedOut',
        indexKeys: { session: 'sess-1' },
        payload: { reason: 'TimedOut', severity: 'Error' },
      }),
    )
    expect(evt.severity).toBe('Info')
  })
})
