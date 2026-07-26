import type { Analyzer } from '../types'

export const navigationStoryAnalyzer: Analyzer = {
  id: 'navigationStory',
  run(bag) {
    const nav = bag.events.filter((e) => e.name.startsWith('Motor.Navigate') || e.name === 'Motor.UrlMapped')
    if (nav.length === 0) return []

    const requested = nav.filter((e) => e.name === 'Motor.NavigateRequested').length
    const completed = nav.filter((e) => e.name === 'Motor.NavigateCompleted').length
    const rejected = nav.filter((e) => e.name === 'Motor.NavigateRejected').length
    const blocked = nav.filter((e) => e.name === 'Motor.NavigateBlocked').length
    const mapped = nav.filter((e) => e.name === 'Motor.UrlMapped').length

    return [
      {
        id: 'navigation-story',
        severity: rejected + blocked > 0 ? 'notable' : 'info',
        analyzer: 'navigationStory',
        title: 'Navigation chapter of the period',
        body:
          `Navigation-related beats: ${nav.length}. Requested=${requested}, Completed=${completed}, ` +
          `Rejected=${rejected}, Blocked=${blocked}, UrlMapped=${mapped}. ` +
          `NavigateCompleted means the navigate command was accepted on the motor/sidecar path — not that the remote document finished loading. ` +
          `NavigateBlocked is a standalone beat (allowlist/build_target) that nests via causationId and never closes a navigate span. ` +
          (rejected + blocked === 0
            ? 'No blocked or rejected navigations in this window.'
            : 'Blocked/rejected navigations deserve operator attention when unexpected for the forwarding allowlist.'),
        evidenceRefs: nav.slice(0, 8).map((e) => e.id),
        relatedFindingIds: [],
        sectionHints: ['chapters', 'proseTimeline', rejected + blocked > 0 ? 'attention' : 'portrait'],
      },
    ]
  },
}
