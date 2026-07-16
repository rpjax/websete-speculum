import { describe, it, expect } from 'vitest'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { buildNarrative, clusterBeats, buildSpans, orderEvents } from './buildNarrative'

const BASE = Date.UTC(2026, 0, 1, 12, 0, 0)

let idSeq = 0
function evt(init: {
  name: string
  offsetMs?: number
  seq?: number
  spanId?: string
  spanKey?: string
  spanRole?: 'Open' | 'Close'
  correlationId?: string
  connectionId?: string
  severity?: string
}): DiagnosticsEventRecord {
  idSeq += 1
  return {
    diagnosticsSchemaVersion: 2,
    id: `evt-${idSeq}`,
    utc: new Date(BASE + (init.offsetMs ?? 0)).toISOString(),
    domain: 'MotorLive',
    name: init.name,
    severity: init.severity ?? 'Info',
    correlationId: init.correlationId ?? null,
    connectionId: init.connectionId ?? 'conn-aaaa-111',
    persistedSessionId: null,
    sidecarSessionId: null,
    seq: init.seq,
    spanId: init.spanId ?? null,
    spanKey: init.spanKey ?? null,
    spanRole: init.spanRole ?? null,
    causationId: null,
    payload: null,
    redaction: 'none',
  }
}

describe('buildNarrative', () => {
  it('builds lanes, chapters, and clusters for a session story', () => {
    const events = [
      evt({ name: 'Motor.SessionStarting', seq: 1, offsetMs: 0, spanId: 's1', spanKey: 'motor.session', spanRole: 'Open', correlationId: 'c1' }),
      evt({ name: 'Motor.SessionStarted', seq: 2, offsetMs: 100, correlationId: 'c1' }),
      evt({ name: 'Motor.SessionStopped', seq: 3, offsetMs: 5000, spanId: 's1', spanKey: 'motor.session', spanRole: 'Close', correlationId: 'c1' }),
    ]
    const narrative = buildNarrative({
      events,
      scope: { kind: 'platform' },
      period: { preset: 'custom', fromMs: BASE - 1000, toMs: BASE + 10_000 },
    })
    expect(narrative.eventCount).toBe(3)
    expect(narrative.lanes.some((l) => l.kind === 'session')).toBe(true)
    expect(narrative.chapters.length).toBeGreaterThanOrEqual(1)
    expect(narrative.chapters[0].spans.length).toBe(1)
    expect(narrative.chapters[0].spans[0].status).toBe('closed')
  })

  it('clusters beats in the same instant window', () => {
    const beats = [
      { event: evt({ name: 'A', offsetMs: 0 }), ms: BASE, clusterKey: null },
      { event: evt({ name: 'B', offsetMs: 20 }), ms: BASE + 20, clusterKey: null },
      { event: evt({ name: 'C', offsetMs: 500 }), ms: BASE + 500, clusterKey: null },
    ]
    const clusters = clusterBeats(beats, 80)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].beats).toHaveLength(2)
  })
})

describe('orderEvents / buildSpans re-exports', () => {
  it('still pairs spans', () => {
    const open = evt({ name: 'Motor.NavigateRequested', seq: 1, spanId: 'n1', spanKey: 'motor.navigate', spanRole: 'Open' })
    const close = evt({ name: 'Motor.NavigateCompleted', seq: 2, offsetMs: 200, spanId: 'n1', spanKey: 'motor.navigate', spanRole: 'Close' })
    const [span] = buildSpans(orderEvents([close, open]))
    expect(span.durationMs).toBe(200)
  })
})
