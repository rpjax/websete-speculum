import { describe, it, expect } from 'vitest'
import { composeTelemetryAnalysis, type AnalysisConsumeInput } from './telemetryAnalysis'
import { telemetryToResourceSamples, type ResourceSample } from './resourceChartCompute'
import type { DiagnosticsEventRecord } from './diagnosticsApi'
import { telemetrySamples } from './mock/fixtures/diagnostics'

function windowAround(samples: ResourceSample[]): AnalysisConsumeInput['window'] {
  const since = samples[0].utc
  const until = samples[samples.length - 1].utc
  return {
    since,
    until,
    spanMs: samples[samples.length - 1].timestamp - samples[0].timestamp,
  }
}

describe('composeTelemetryAnalysis', () => {
  const records = telemetrySamples()
  const samples = telemetryToResourceSamples(records)
  // Use a slice that includes leak (t~70-92) + healthy stretch
  const slice = samples.slice(60, 120)
  const events: DiagnosticsEventRecord[] = [
    {
      diagnosticsSchemaVersion: 1,
      id: 'e1',
      utc: slice[10].utc,
      domain: 'DiagnosticsSelf',
      name: 'Diagnostics.Degraded',
      severity: 'Warning',
      payload: {},
      redaction: 'none',
    },
    {
      diagnosticsSchemaVersion: 1,
      id: 'e2',
      utc: slice[20].utc,
      domain: 'MotorLive',
      name: 'Motor.SessionStarted',
      severity: 'Info',
      payload: {},
      redaction: 'none',
    },
  ]

  const input: AnalysisConsumeInput = {
    samples: slice,
    events,
    runtime: null,
    overview: null,
    host: null,
    window: windowAround(slice),
    coverage: {
      samples: slice.length,
      bucketed: false,
      truncated: false,
      events: events.length,
      dataSources: ['telemetry.history', 'events'],
    },
  }

  it('produces a complete report — not problem-only', () => {
    const report = composeTelemetryAnalysis(input)
    expect(report.executive.headline.length).toBeGreaterThan(10)
    expect(report.executive.periodSummary.length).toBeGreaterThan(20)
    expect(report.chapters.length).toBeGreaterThanOrEqual(6)
    expect(report.metricAtlas.length).toBeGreaterThan(10)
    expect(report.metricAtlas.some((m) => m.present)).toBe(true)
    expect(report.stability.length).toBeGreaterThan(0)
    expect(report.conclusions.length).toBeGreaterThan(0)
    expect(report.chapters.some((c) => c.id === 'stability')).toBe(true)
    expect(report.chapters.some((c) => c.id === 'atlas')).toBe(true)
    expect(report.chapters.every((c) => c.body.length > 0)).toBe(true)
  })

  it('includes correlations and chronology', () => {
    const report = composeTelemetryAnalysis(input)
    expect(report.correlations.length).toBeGreaterThan(0)
    expect(report.chronology.some((c) => c.title.includes('Degraded') || c.title === 'Diagnostics.Degraded')).toBe(true)
  })

  it('records substrate honesty when truncated', () => {
    const report = composeTelemetryAnalysis({
      ...input,
      coverage: { ...input.coverage, truncated: true, bucketed: true },
    })
    expect(report.meta.coverage.truncated).toBe(true)
    expect(report.chapters.find((c) => c.id === 'period')!.body.some((p) => /substrate|bucketed/i.test(p))).toBe(true)
  })
})
