import { describe, expect, it } from 'vitest'
import { narrateReport, REQUIRED_REPORT_SECTIONS } from '../pipeline/narrate'
import type { EvidenceBag, Finding } from '../types'

function emptyBag(overrides?: Partial<EvidenceBag>): EvidenceBag {
  const now = Date.now()
  return {
    mandate: {
      fromMs: now - 3600_000,
      toMs: now,
      scope: { kind: 'platform' },
      depth: 'standard',
      profile: 'operational',
      includeEvents: true,
      includeTelemetry: true,
      includeRuntime: true,
      includeSnapshots: false,
    },
    events: [],
    narrative: null,
    telemetry: [],
    overview: null,
    runtime: null,
    snapshots: [],
    gaps: ['No events in window'],
    catalogNames: [],
    ...overrides,
  }
}

describe('narrateReport structure', () => {
  it('emits every required section even with zero findings', () => {
    const report = narrateReport(emptyBag(), [])
    const ids = report.sections.map((s) => s.id)
    for (const id of REQUIRED_REPORT_SECTIONS) {
      expect(ids).toContain(id)
    }
    expect(report.sections).toHaveLength(REQUIRED_REPORT_SECTIONS.length)
  })

  it('keeps attention section when no problems (coaching, not omitted)', () => {
    const report = narrateReport(emptyBag(), [])
    const attention = report.sections.find((s) => s.id === 'attention')
    expect(attention).toBeDefined()
    expect(attention!.paragraphs.join(' ')).toMatch(/No attention/i)
    expect(attention!.findings).toHaveLength(0)
  })

  it('places attention findings only in attention section list', () => {
    const findings: Finding[] = [
      {
        id: 'attn-1',
        severity: 'attention',
        analyzer: 'test',
        title: 'Probe failed',
        body: 'A probe ended with errorCode + phase.',
        evidenceRefs: ['e1'],
        relatedFindingIds: [],
        sectionHints: ['attention', 'signals'],
      },
      {
        id: 'info-1',
        severity: 'info',
        analyzer: 'volumePortrait',
        title: 'Quiet volume',
        body: 'Few beats.',
        evidenceRefs: [],
        relatedFindingIds: [],
        sectionHints: ['portrait'],
      },
    ]
    const report = narrateReport(emptyBag(), findings)
    const attention = report.sections.find((s) => s.id === 'attention')!
    expect(attention.findings.map((f) => f.id)).toContain('attn-1')
    expect(attention.findings.every((f) => f.severity === 'attention' || f.severity === 'critical')).toBe(true)
    const portrait = report.sections.find((s) => s.id === 'portrait')!
    expect(portrait.findings.map((f) => f.id)).toContain('info-1')
  })

  it('cover mentions mandate and gaps', () => {
    const report = narrateReport(emptyBag({ gaps: ['telemetry empty'] }), [])
    const cover = report.sections.find((s) => s.id === 'cover')!
    const text = cover.paragraphs.join(' ')
    expect(text).toMatch(/operational|standard/i)
    expect(text).toMatch(/telemetry empty/)
  })
})
