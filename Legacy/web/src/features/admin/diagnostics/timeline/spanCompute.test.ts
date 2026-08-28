import { describe, it, expect } from 'vitest'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { buildSpans, buildStories, orderEvents, SPAN_ABANDONED_EVENT } from './spanCompute'

const BASE = Date.UTC(2026, 0, 1, 12, 0, 0)

interface EvtInit {
  name: string
  offsetMs?: number
  seq?: number
  spanId?: string
  spanKey?: string
  spanRole?: 'Open' | 'Close'
  causationId?: string
  correlationId?: string
  connectionId?: string
  severity?: string
  domain?: string
}

let idSeq = 0
function evt(init: EvtInit): DiagnosticsEventRecord {
  idSeq += 1
  return {
    diagnosticsSchemaVersion: 2,
    id: `evt-${idSeq}`,
    utc: new Date(BASE + (init.offsetMs ?? 0)).toISOString(),
    domain: init.domain ?? 'MotorLive',
    name: init.name,
    severity: init.severity ?? 'Info',
    correlationId: init.correlationId ?? null,
    connectionId: init.connectionId ?? null,
    persistedSessionId: null,
    sidecarSessionId: null,
    seq: init.seq,
    spanId: init.spanId ?? null,
    spanKey: init.spanKey ?? null,
    spanRole: init.spanRole ?? null,
    causationId: init.causationId ?? null,
    payload: null,
    redaction: 'none',
  }
}

describe('orderEvents', () => {
  it('orders by seq first, regardless of insertion order', () => {
    const a = evt({ name: 'A', seq: 3, offsetMs: 0 })
    const b = evt({ name: 'B', seq: 1, offsetMs: 0 })
    const c = evt({ name: 'C', seq: 2, offsetMs: 0 })
    const ordered = orderEvents([a, b, c])
    expect(ordered.map((e) => e.name)).toEqual(['B', 'C', 'A'])
  })

  it('falls back to utc then id when seq is absent (v1 events)', () => {
    const a = evt({ name: 'A', offsetMs: 200 })
    const b = evt({ name: 'B', offsetMs: 100 })
    const ordered = orderEvents([a, b])
    expect(ordered.map((e) => e.name)).toEqual(['B', 'A'])
  })
})

describe('buildSpans', () => {
  it('pairs an open beat with its close beat by spanId', () => {
    const open = evt({ name: 'Motor.NavigateRequested', seq: 1, offsetMs: 0, spanId: 's1', spanKey: 'motor.navigate' })
    const close = evt({ name: 'Motor.NavigateCompleted', seq: 2, offsetMs: 500, spanId: 's1', spanKey: 'motor.navigate' })
    const [span] = buildSpans([close, open])
    expect(span.spanId).toBe('s1')
    expect(span.spanKey).toBe('motor.navigate')
    expect(span.status).toBe('closed')
    expect(span.ok).toBe(true)
    expect(span.durationMs).toBe(500)
  })

  it('marks a lone open beat as still open', () => {
    const open = evt({ name: 'Motor.NavigateRequested', seq: 1, spanId: 's1', spanKey: 'motor.navigate' })
    const [span] = buildSpans([open])
    expect(span.status).toBe('open')
    expect(span.close).toBeNull()
    expect(span.durationMs).toBeNull()
  })

  it('classifies an abandoned close from the synthetic marker', () => {
    const open = evt({ name: 'Motor.NavigateRequested', seq: 1, spanId: 's1', spanKey: 'motor.navigate' })
    const abandoned = evt({ name: SPAN_ABANDONED_EVENT, seq: 2, offsetMs: 60_000, spanId: 's1', spanKey: 'motor.navigate', severity: 'Warning', domain: 'DiagnosticsSelf' })
    const [span] = buildSpans([open, abandoned])
    expect(span.status).toBe('abandoned')
    expect(span.ok).toBe(false)
  })

  it('treats a Warning/Error close as not-ok even when cleanly closed', () => {
    const open = evt({ name: 'Motor.NavigateRequested', seq: 1, spanId: 's1' })
    const close = evt({ name: 'Motor.NavigateRejected', seq: 2, spanId: 's1', severity: 'Warning' })
    const [span] = buildSpans([open, close])
    expect(span.status).toBe('closed')
    expect(span.ok).toBe(false)
  })

  it('ignores beats without a spanId (standalone / close-without-open)', () => {
    const beat = evt({ name: 'Motor.NavigateBlocked', seq: 1, spanKey: 'motor.navigate' })
    expect(buildSpans([beat])).toHaveLength(0)
  })

  it('skips a lone close beat whose open fell outside the window (spanRole from wire)', () => {
    const loneClose = evt({ name: 'Motor.NavigateCompleted', seq: 9, spanId: 's1', spanKey: 'motor.navigate', spanRole: 'Close' })
    expect(buildSpans([loneClose])).toHaveLength(0)
  })

  it('skips a lone abandon close even without spanRole (backward-compatible marker fallback)', () => {
    const loneAbandon = evt({ name: SPAN_ABANDONED_EVENT, seq: 9, spanId: 's1', spanKey: 'motor.navigate', severity: 'Warning', domain: 'DiagnosticsSelf' })
    expect(buildSpans([loneAbandon])).toHaveLength(0)
  })

  it('still renders a lone open beat (spanRole Open) as still-open', () => {
    const loneOpen = evt({ name: 'Motor.SessionStarting', seq: 1, spanId: 's1', spanKey: 'motor.session', spanRole: 'Open' })
    const [span] = buildSpans([loneOpen])
    expect(span.status).toBe('open')
  })

  it('computes nesting depth from the causation chain', () => {
    const outer = evt({ name: 'Motor.SessionStarting', seq: 1, spanId: 'session', spanKey: 'motor.session' })
    const innerOpen = evt({ name: 'Motor.StateExportRequested', seq: 2, spanId: 'export', spanKey: 'motor.export', causationId: 'session' })
    const innerClose = evt({ name: 'Motor.StateExportCompleted', seq: 3, spanId: 'export', spanKey: 'motor.export' })
    const spans = buildSpans([outer, innerOpen, innerClose])
    expect(spans.find((s) => s.spanId === 'session')!.depth).toBe(0)
    expect(spans.find((s) => s.spanId === 'export')!.depth).toBe(1)
  })
})

describe('buildStories', () => {
  it('groups by correlationId and orders beats by seq', () => {
    const events = [
      evt({ name: 'Motor.SessionStarting', seq: 1, correlationId: 'c1', connectionId: 'conn1', spanId: 'sp', spanKey: 'motor.session' }),
      evt({ name: 'Motor.SessionResolved', seq: 2, correlationId: 'c1', connectionId: 'conn1' }),
      evt({ name: 'Motor.SessionStopped', seq: 3, correlationId: 'c1', connectionId: 'conn1', spanId: 'sp', spanKey: 'motor.session' }),
    ]
    const stories = buildStories(events)
    expect(stories).toHaveLength(1)
    expect(stories[0].correlationId).toBe('c1')
    expect(stories[0].connectionId).toBe('conn1')
    expect(stories[0].events.map((e) => e.name)).toEqual([
      'Motor.SessionStarting', 'Motor.SessionResolved', 'Motor.SessionStopped',
    ])
    expect(stories[0].spans).toHaveLength(1)
    expect(stories[0].spans[0].status).toBe('closed')
  })

  it('falls back to connectionId when correlation is absent, and a system bucket otherwise', () => {
    const events = [
      evt({ name: 'Sidecar.ScreencastFrame', seq: 1, connectionId: 'conn2', severity: 'Metric', domain: 'SidecarBrowser' }),
      evt({ name: 'Diagnostics.CleanupPurged', seq: 2, severity: 'Info', domain: 'DiagnosticsSelf' }),
    ]
    const stories = buildStories(events)
    const keys = stories.map((s) => s.key).sort()
    expect(keys).toEqual(['conn:conn2', 'system'])
  })

  it('counts warnings/errors and sorts most-recent story first', () => {
    const events = [
      evt({ name: 'Motor.NavigateRequested', seq: 1, offsetMs: 0, correlationId: 'old' }),
      evt({ name: 'Motor.NavigateRequested', seq: 2, offsetMs: 10_000, correlationId: 'new' }),
      evt({ name: 'Motor.NavigateRejected', seq: 3, offsetMs: 10_500, correlationId: 'new', severity: 'Warning' }),
    ]
    const stories = buildStories(events)
    expect(stories[0].correlationId).toBe('new')
    expect(stories[0].errorCount).toBe(1)
    expect(stories[1].correlationId).toBe('old')
  })
})
