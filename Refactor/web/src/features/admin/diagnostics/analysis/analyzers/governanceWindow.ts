import type { Analyzer } from '../types'

export const governanceWindowAnalyzer: Analyzer = {
  id: 'governanceWindow',
  run(bag) {
    const gov = bag.events.filter((e) => e.domain === 'DiagnosticsSelf' || e.name.startsWith('Diagnostics.'))
    const runtime = bag.runtime
    const overview = bag.overview

    if (gov.length === 0 && !runtime && !overview) return []

    const degradedEvents = gov.filter((e) => e.name === 'Diagnostics.Degraded').length
    const recovered = gov.filter((e) => e.name === 'Diagnostics.Recovered').length
    const elevate = gov.filter((e) => e.name === 'Diagnostics.ElevateStarted').length
    const overflow = gov.filter((e) => e.name === 'Diagnostics.StorageOverflow').length

    const lines: string[] = []
    if (runtime) {
      lines.push(
        `Runtime now: degraded=${runtime.degraded}, elevate.active=${runtime.elevate?.active ?? false}, ` +
        `bytesUsed=${runtime.bytesUsed}/${runtime.storageMaxBytes}, eventsStored=${runtime.eventsStored}, ` +
        `eventsDropped=${runtime.eventsDropped}, overflowCount=${runtime.overflowCount}, probeInFlight=${runtime.probeInFlight}.`,
      )
    }
    if (overview?.needsAttention?.length) {
      lines.push(`Overview needsAttention: ${overview.needsAttention.join('; ')}.`)
    }

    return [
      {
        id: 'governance-window',
        severity: (runtime?.degraded || overflow > 0) ? 'attention' : elevate > 0 ? 'notable' : 'info',
        analyzer: 'governanceWindow',
        title: 'Governance and diagnostics self-story',
        body:
          `DiagnosticsSelf beats in period: ${gov.length} (Degraded=${degradedEvents}, Recovered=${recovered}, ` +
          `ElevateStarted=${elevate}, StorageOverflow=${overflow}). ` +
          lines.join(' ') +
          ` Degraded caps non-Metric capabilities; Elevate TTL forces BrowserQuery probe + SidecarBrowser on. ` +
          `These windows explain gaps in probe/event completeness rather than motor session bugs by themselves.`,
        evidenceRefs: gov.slice(0, 8).map((e) => e.id),
        relatedFindingIds: [],
        sectionHints: ['governance', runtime?.degraded || overflow > 0 ? 'attention' : 'portrait'],
      },
    ]
  },
}
