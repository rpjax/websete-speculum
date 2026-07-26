import type { Analyzer } from '../types'

export const probeStoryAnalyzer: Analyzer = {
  id: 'probeStory',
  run(bag) {
    const probes = bag.events.filter((e) => e.name.startsWith('Sidecar.DiagProbe'))
    if (probes.length === 0) return []

    const completed = probes.filter((e) => e.name.endsWith('Completed')).length
    const timedOut = probes.filter((e) => e.name.endsWith('TimedOut')).length
    const rejected = probes.filter((e) => e.name.endsWith('Rejected')).length
    const busy = probes.filter((e) => e.name.endsWith('Busy')).length

    return [
      {
        id: 'probe-story',
        severity: timedOut + rejected + busy > 0 ? 'notable' : 'info',
        analyzer: 'probeStory',
        title: 'Browser probe story',
        body:
          `Sidecar DiagProbe beats: ${probes.length}. Completed=${completed}, TimedOut=${timedOut}, ` +
          `Rejected=${rejected}, Busy=${busy}. ` +
          `DiagProbeBusy is a standalone concurrency-gate beat (never a span close). ` +
          (completed > 0 && timedOut + rejected + busy === 0
            ? 'All observed probes completed without timeout/rejection/busy in this window.'
            : 'Probe friction (timeout/reject/busy) often correlates with elevate/degraded capability state or sidecar load.'),
        evidenceRefs: probes.slice(0, 8).map((e) => e.id),
        relatedFindingIds: [],
        sectionHints: ['chapters', timedOut + rejected > 0 ? 'attention' : 'portrait'],
      },
    ]
  },
}
