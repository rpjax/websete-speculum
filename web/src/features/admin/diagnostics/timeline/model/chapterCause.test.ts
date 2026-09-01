import { describe, it, expect } from 'vitest'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import type { NarrativeBeat, NarrativeChapter } from './narrativeTypes'
import { resolveChapterCause, salientBeats } from './chapterCause'

function beat(partial: {
  id: string
  name: string
  ms: number
  severity?: string
  reason?: string
}): NarrativeBeat {
  const event: DiagnosticsEventRecord = {
    diagnosticsSchemaVersion: 2,
    id: partial.id,
    name: partial.name,
    domain: 'Sessions',
    severity: partial.severity ?? 'Info',
    utc: new Date(partial.ms).toISOString(),
    seq: null,
    payload: partial.reason ? { reason: partial.reason } : null,
    redaction: 'none',
  }
  return { ms: partial.ms, clusterKey: null, event }
}

function chapter(beats: NarrativeBeat[], outcome: NarrativeChapter['outcome'] = 'ok'): NarrativeChapter {
  return {
    key: 't',
    correlationId: null,
    connectionId: 'sess-1',
    beats,
    spans: [],
    startMs: beats[0]?.ms ?? 0,
    endMs: beats[beats.length - 1]?.ms ?? 0,
    durationMs: 1000,
    errorCount: 0,
    outcome,
    proseHint: 'hint',
  }
}

describe('chapterCause', () => {
  it('explains TimedOut as lifecycle close, not fault', () => {
    const cause = resolveChapterCause(
      chapter([
        beat({ id: '1', name: 'Sessions.SessionStarting', ms: 1 }),
        beat({ id: '2', name: 'Sessions.SessionTimedOut', ms: 2, reason: 'TimedOut' }),
      ]),
    )
    expect(cause?.kind).toBe('lifecycle')
    expect(cause?.title).toMatch(/lifecycle close/i)
    expect(cause?.detail).toMatch(/not an operator fault|not a fault/i)
  })

  it('filters SampleCollected out of salient beats', () => {
    const c = chapter([
      beat({ id: '1', name: 'Sessions.SessionStarting', ms: 1 }),
      beat({ id: '2', name: 'Telemetry.Sampling.SampleCollected', ms: 2, severity: 'Metric' }),
      beat({ id: '3', name: 'Sessions.SessionTimedOut', ms: 3, reason: 'TimedOut' }),
    ])
    const s = salientBeats(c)
    expect(s.map((b) => b.event.name)).not.toContain('Telemetry.Sampling.SampleCollected')
    expect(s).toHaveLength(2)
  })
})
