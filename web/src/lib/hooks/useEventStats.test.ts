import { describe, it, expect } from 'vitest'
import { computeEventStats } from './useEventStats'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

function makeEvent(overrides: Partial<DiagnosticsEventRecord> = {}): DiagnosticsEventRecord {
  return {
    diagnosticsSchemaVersion: 1,
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
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

describe('computeEventStats', () => {
  it('returns zeroed stats for empty input', () => {
    const stats = computeEventStats([])
    expect(stats.total).toBe(0)
    expect(stats.errorCount).toBe(0)
    expect(stats.warningCount).toBe(0)
    expect(stats.uniqueConnections).toBe(0)
    expect(stats.uniqueCorrelations).toBe(0)
    expect(stats.eventRate).toBe(0)
    expect(stats.topEvents).toEqual([])
    expect(stats.topDomains).toEqual([])
    expect(stats.severityDistribution).toEqual([])
  })

  it('counts events by domain', () => {
    const events = [
      makeEvent({ domain: 'MotorLive' }),
      makeEvent({ domain: 'MotorLive' }),
      makeEvent({ domain: 'SidecarBrowser' }),
    ]
    const stats = computeEventStats(events)
    expect(stats.byDomain['MotorLive']).toBe(2)
    expect(stats.byDomain['SidecarBrowser']).toBe(1)
  })

  it('counts events by severity', () => {
    const events = [
      makeEvent({ severity: 'Info' }),
      makeEvent({ severity: 'Error' }),
      makeEvent({ severity: 'Error' }),
      makeEvent({ severity: 'Warning' }),
    ]
    const stats = computeEventStats(events)
    expect(stats.errorCount).toBe(2)
    expect(stats.warningCount).toBe(1)
    expect(stats.bySeverity['Info']).toBe(1)
  })

  it('counts unique connections and correlations', () => {
    const events = [
      makeEvent({ connectionId: 'conn-1', correlationId: 'corr-a' }),
      makeEvent({ connectionId: 'conn-1', correlationId: 'corr-b' }),
      makeEvent({ connectionId: 'conn-2', correlationId: 'corr-a' }),
    ]
    const stats = computeEventStats(events)
    expect(stats.uniqueConnections).toBe(2)
    expect(stats.uniqueCorrelations).toBe(2)
  })

  it('computes event rate over time span', () => {
    const events = [
      makeEvent({ utc: '2025-01-01T00:00:00Z' }),
      makeEvent({ utc: '2025-01-01T00:01:00Z' }),
      makeEvent({ utc: '2025-01-01T00:02:00Z' }),
    ]
    const stats = computeEventStats(events)
    expect(stats.timeSpanMs).toBe(120_000)
    expect(stats.eventRate).toBeCloseTo(1.5, 1)
  })

  it('produces top events sorted by count', () => {
    const events = [
      makeEvent({ name: 'Motor.SessionStarted' }),
      makeEvent({ name: 'Motor.SessionStarted' }),
      makeEvent({ name: 'Motor.SessionStarted' }),
      makeEvent({ name: 'Motor.NavigateCompleted' }),
    ]
    const stats = computeEventStats(events)
    expect(stats.topEvents[0].name).toBe('Motor.SessionStarted')
    expect(stats.topEvents[0].count).toBe(3)
  })

  it('produces severity distribution with percentages', () => {
    const events = [
      makeEvent({ severity: 'Info' }),
      makeEvent({ severity: 'Info' }),
      makeEvent({ severity: 'Error' }),
      makeEvent({ severity: 'Error' }),
    ]
    const stats = computeEventStats(events)
    const infoEntry = stats.severityDistribution.find((s) => s.severity === 'Info')
    expect(infoEntry).toBeDefined()
    expect(infoEntry!.pct).toBe(50)
  })

  it('computes rate-over-time buckets', () => {
    const events = [
      makeEvent({ utc: '2025-01-01T00:00:00Z' }),
      makeEvent({ utc: '2025-01-01T00:05:00Z' }),
      makeEvent({ utc: '2025-01-01T00:10:00Z' }),
    ]
    const stats = computeEventStats(events)
    expect(stats.rateOverTime.length).toBe(12)
    expect(stats.rateOverTime.reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('handles single event', () => {
    const stats = computeEventStats([makeEvent()])
    expect(stats.total).toBe(1)
    expect(stats.eventRate).toBe(0)
    expect(stats.rateOverTime).toEqual([1])
  })
})
