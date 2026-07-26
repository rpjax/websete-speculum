import { describe, it, expect } from 'vitest'
import { volumePortraitAnalyzer } from './volumePortrait'
import { narrateReport } from '../pipeline/narrate'
import type { EvidenceBag, AnalysisMandate } from '../types'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { buildNarrative } from '../../timeline/model/buildNarrative'

const mandate: AnalysisMandate = {
  fromMs: Date.UTC(2026, 0, 1, 12, 0, 0),
  toMs: Date.UTC(2026, 0, 1, 13, 0, 0),
  scope: { kind: 'platform' },
  depth: 'standard',
  profile: 'operational',
  includeEvents: true,
  includeTelemetry: true,
  includeRuntime: true,
  includeSnapshots: false,
}

function sampleEvents(): DiagnosticsEventRecord[] {
  const base = mandate.fromMs
  return [
    {
      diagnosticsSchemaVersion: 2,
      id: '1',
      utc: new Date(base + 1000).toISOString(),
      domain: 'MotorLive',
      name: 'Motor.SessionStarted',
      severity: 'Info',
      correlationId: 'c1',
      connectionId: 'conn-1',
      payload: {},
      redaction: 'none',
    },
    {
      diagnosticsSchemaVersion: 2,
      id: '2',
      utc: new Date(base + 2000).toISOString(),
      domain: 'MotorLive',
      name: 'Motor.SessionStopped',
      severity: 'Info',
      correlationId: 'c1',
      connectionId: 'conn-1',
      payload: {},
      redaction: 'none',
    },
  ]
}

describe('analysis pipeline smoke', () => {
  it('volume portrait emits info findings for routine traffic', () => {
    const events = sampleEvents()
    const bag: EvidenceBag = {
      mandate,
      events,
      narrative: buildNarrative({
        events,
        scope: { kind: 'platform' },
        period: { preset: 'custom', fromMs: mandate.fromMs, toMs: mandate.toMs },
      }),
      telemetry: [],
      overview: null,
      runtime: null,
      snapshots: [],
      gaps: [],
      catalogNames: ['Motor.SessionStarted'],
    }
    const findings = volumePortraitAnalyzer.run(bag)
    expect(findings.some((f) => f.severity === 'info')).toBe(true)
    expect(findings[0].body.toLowerCase()).toContain('beats')
  })

  it('narrate keeps routine sections even without errors', () => {
    const events = sampleEvents()
    const bag: EvidenceBag = {
      mandate,
      events,
      narrative: buildNarrative({
        events,
        scope: { kind: 'platform' },
        period: { preset: 'custom', fromMs: mandate.fromMs, toMs: mandate.toMs },
      }),
      telemetry: [],
      overview: null,
      runtime: null,
      snapshots: [],
      gaps: [],
      catalogNames: [],
    }
    const findings = volumePortraitAnalyzer.run(bag)
    const report = narrateReport(bag, findings)
    expect(report.sections.some((s) => s.id === 'cover')).toBe(true)
    expect(report.sections.some((s) => s.id === 'attention')).toBe(true)
    const attention = report.sections.find((s) => s.id === 'attention')!
    expect(attention.paragraphs.join(' ').toLowerCase()).toMatch(/no attention|critical/)
  })
})
