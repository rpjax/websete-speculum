import { describe, expect, it } from 'vitest'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { buildMixedJournalStream } from './journalStreamModel'

function ev(
  partial: Partial<DiagnosticsEventRecord> & Pick<DiagnosticsEventRecord, 'id' | 'name' | 'utc'>,
): DiagnosticsEventRecord {
  return {
    diagnosticsSchemaVersion: 2,
    domain: 'Sessions',
    severity: 'Info',
    connectionId: null,
    correlationId: null,
    spanId: null,
    spanKey: null,
    spanRole: null,
    causationId: null,
    seq: null,
    payload: null,
    redaction: 'none',
    ...partial,
  }
}

describe('buildMixedJournalStream', () => {
  it('interleaves loose telemetry with session groups by chronological anchor', () => {
    const events = [
      ev({
        id: 's1',
        name: 'Sessions.SessionStarting',
        utc: '2026-08-03T01:00:00.000Z',
        connectionId: 'sess-a',
        seq: 1,
      }),
      ev({
        id: 's2',
        name: 'Sessions.SessionStopped',
        utc: '2026-08-03T01:10:00.000Z',
        connectionId: 'sess-a',
        seq: 3,
      }),
      ev({
        id: 't1',
        name: 'Telemetry.Sampling.SampleCollected',
        utc: '2026-08-03T01:05:00.000Z',
        domain: 'Telemetry',
        severity: 'Metric',
        seq: 2,
      }),
      ev({
        id: 't2',
        name: 'Telemetry.Sampling.SampleCollected',
        utc: '2026-08-03T00:50:00.000Z',
        domain: 'Telemetry',
        severity: 'Metric',
        seq: 0,
      }),
    ]

    const items = buildMixedJournalStream(events, { groupSessionFacts: true })
    // Newest first: telemetry 01:05, session group (anchor 01:00), telemetry 00:50.
    expect(items.map((i) => i.kind)).toEqual(['fact', 'group', 'fact'])
    if (items[0].kind === 'fact') expect(items[0].event.id).toBe('t1')
    if (items[1].kind === 'group') expect(items[1].group.sessionId).toBe('sess-a')
    if (items[2].kind === 'fact') expect(items[2].event.id).toBe('t2')
  })

  it('leaves everything loose when session grouping is off', () => {
    const events = [
      ev({
        id: 's1',
        name: 'Sessions.SessionStarting',
        utc: '2026-08-03T01:00:00.000Z',
        connectionId: 'sess-a',
        seq: 1,
      }),
      ev({
        id: 's2',
        name: 'Sessions.SessionStopped',
        utc: '2026-08-03T01:10:00.000Z',
        connectionId: 'sess-a',
        seq: 2,
      }),
    ]
    const items = buildMixedJournalStream(events, { groupSessionFacts: false })
    expect(items.every((i) => i.kind === 'fact')).toBe(true)
    expect(items).toHaveLength(2)
  })

  it('does not invent a Platform / domain bucket', () => {
    const events = [
      ev({ id: 'p1', name: 'Diagnostics.ConfigApplied', utc: '2026-08-03T03:00:00.000Z', domain: 'Diagnostics' }),
      ev({
        id: 's1',
        name: 'Sessions.SessionStarted',
        utc: '2026-08-03T02:00:00.000Z',
        connectionId: 'abc',
        seq: 10,
      }),
      ev({
        id: 's2',
        name: 'Sessions.SessionStopped',
        utc: '2026-08-03T02:05:00.000Z',
        connectionId: 'abc',
        seq: 11,
      }),
    ]
    const items = buildMixedJournalStream(events, { groupSessionFacts: true })
    expect(items.some((i) => i.kind === 'group' && i.group.title === 'Platform')).toBe(false)
    expect(items.filter((i) => i.kind === 'fact')).toHaveLength(1)
    expect(items.filter((i) => i.kind === 'group')).toHaveLength(1)
  })

  it('keeps a single session fact loose (grouping needs correlation of 2+)', () => {
    const events = [
      ev({
        id: 's1',
        name: 'Sessions.SessionStarted',
        utc: '2026-08-03T02:00:00.000Z',
        connectionId: 'lonely',
        seq: 1,
      }),
    ]
    const items = buildMixedJournalStream(events, { groupSessionFacts: true })
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('fact')
  })

  it('supports oldest-first sort by chronological anchor', () => {
    const events = [
      ev({
        id: 's1',
        name: 'Sessions.SessionStarting',
        utc: '2026-08-03T01:00:00.000Z',
        connectionId: 'sess-a',
        seq: 1,
      }),
      ev({
        id: 's2',
        name: 'Sessions.SessionStopped',
        utc: '2026-08-03T01:10:00.000Z',
        connectionId: 'sess-a',
        seq: 3,
      }),
      ev({
        id: 't1',
        name: 'Telemetry.Sampling.SampleCollected',
        utc: '2026-08-03T01:05:00.000Z',
        domain: 'Telemetry',
        severity: 'Metric',
        seq: 2,
      }),
    ]
    const items = buildMixedJournalStream(events, { groupSessionFacts: true }, 'oldest')
    expect(items.map((i) => i.kind)).toEqual(['group', 'fact'])
    if (items[0].kind === 'group') expect(items[0].group.sessionId).toBe('sess-a')
    if (items[1].kind === 'fact') expect(items[1].event.id).toBe('t1')
  })
})
