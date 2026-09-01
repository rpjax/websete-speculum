import type { Analyzer } from '../types'

export const evidenceCompletenessAnalyzer: Analyzer = {
  id: 'evidenceCompleteness',
  run(bag) {
    const parts = [...bag.gaps]
    if (bag.events.length === 0) parts.push('No events loaded for the mandate period/scope.')
    if (bag.mandate.includeTelemetry && bag.telemetry.length === 0) {
      parts.push('Telemetry requested but empty — check telemetry.enabled and section toggles.')
    }
    if (bag.catalogNames.length === 0) parts.push('Catalog names missing — UI prose may rely on local constants.')
    if (bag.runtime?.redactionMode === 'production') {
      parts.push('Production redaction is active — identity fields in evidence may be masked.')
    }

    return [
      {
        id: 'evidence-completeness',
        severity: parts.length > 2 ? 'notable' : 'info',
        analyzer: 'evidenceCompleteness',
        title: 'Evidence completeness and limitations',
        body:
          parts.length === 0
            ? 'Evidence collection completed without recorded gaps for the enabled mandate toggles. Interpret findings with normal retention/TTL caveats.'
            : `Limitations recorded for this analysis:\n• ${parts.join('\n• ')}\n` +
              'These gaps do not imply absence of motor activity — they constrain how complete this report can be.',
        evidenceRefs: [],
        relatedFindingIds: [],
        sectionHints: ['cover', 'governance', 'glossary'],
      },
    ]
  },
}
