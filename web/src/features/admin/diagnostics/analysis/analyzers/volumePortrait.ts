import type { Analyzer, Finding } from '../types'
import { formatDuration } from '@/lib/diagnosticsConstants'

export const volumePortraitAnalyzer: Analyzer = {
  id: 'volumePortrait',
  run(bag) {
    if (bag.events.length === 0) return []
    const durationMs = Math.max(1, bag.mandate.toMs - bag.mandate.fromMs)
    const rate = (bag.events.length / (durationMs / 60_000)).toFixed(2)
    const sessions = new Set(bag.events.map((e) => e.connectionId).filter(Boolean)).size
    const errors = bag.events.filter((e) => e.severity === 'Error').length
    const warnings = bag.events.filter((e) => e.severity === 'Warning').length
    const byDomain: Record<string, number> = {}
    for (const e of bag.events) byDomain[e.domain] = (byDomain[e.domain] ?? 0) + 1

    const domainLine = Object.entries(byDomain)
      .sort((a, b) => b[1] - a[1])
      .map(([d, n]) => `${d}: ${n}`)
      .join('; ')

    const findings: Finding[] = [
      {
        id: 'volume-portrait',
        severity: 'info',
        analyzer: 'volumePortrait',
        title: 'Period volume portrait',
        body:
          `Across ${formatDuration(durationMs)}, the evidence bag contains ${bag.events.length} beats ` +
          `(≈ ${rate}/min), spanning ${sessions} session lane(s). ` +
          `Severity mix: ${errors} error(s), ${warnings} warning(s), remainder informational/metric. ` +
          `Domain mix — ${domainLine || 'n/a'}. ` +
          `What this means: this portrait describes activity density and domain mix; it is not by itself a health verdict. ` +
          `Read Chapters and Attention before concluding the period was “quiet” or “broken.”`,
        evidenceRefs: bag.events.slice(0, 5).map((e) => e.id),
        relatedFindingIds: [],
        sectionHints: ['portrait', 'cover'],
      },
    ]

    if (bag.narrative) {
      findings.push({
        id: 'volume-cast-size',
        severity: 'info',
        analyzer: 'volumePortrait',
        title: 'Narrative cast size',
        body:
          `The reconstructed narrative has ${bag.narrative.lanes.length} lane(s) and ` +
          `${bag.narrative.chapters.length} chapter(s). ` +
          `Chapters are correlation-scoped stories (or session/system buckets when correlation is absent).`,
        evidenceRefs: [],
        relatedFindingIds: ['volume-portrait'],
        sectionHints: ['cast', 'portrait'],
      })
    }

    return findings
  },
}
