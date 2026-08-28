import type { Analyzer } from '../types'

export const sessionLifecycleAnalyzer: Analyzer = {
  id: 'sessionLifecycle',
  run(bag) {
    const life = bag.events.filter((e) => e.name.startsWith('Motor.Session') || e.name.startsWith('Motor.Slot'))
    if (life.length === 0) return []

    const started = life.filter((e) => e.name === 'Motor.SessionStarted').length
    const stopped = life.filter((e) => e.name === 'Motor.SessionStopped').length
    const refused = life.filter((e) => e.name === 'Motor.SessionRefused').length
    const failed = life.filter((e) => e.name === 'Motor.SessionStartFailed').length
    const resolved = life.filter((e) => e.name === 'Motor.SessionResolved')
    const restored = resolved.filter((e) => {
      const p = e.payload as Record<string, unknown> | null
      return p?.restored === true
    }).length

    return [
      {
        id: 'session-lifecycle',
        severity: refused + failed > 0 ? 'attention' : 'info',
        analyzer: 'sessionLifecycle',
        title: 'Session lifecycle summary',
        body:
          `Lifecycle beats: ${life.length}. Started=${started}, Stopped=${stopped}, ` +
          `StartFailed=${failed}, Refused=${refused}, SessionResolved=${resolved.length} (restored=${restored}). ` +
          `SessionResolved carries identity/persist facts (clientTokenProvided, restored, cookie/localStorage/history counts) before sidecar start. ` +
          (refused > 0
            ? `${refused} session(s) were refused at the capacity gate (typically errorCode session_limit).`
            : 'No capacity refusals in this window.'),
        evidenceRefs: life.slice(0, 8).map((e) => e.id),
        relatedFindingIds: [],
        sectionHints: ['cast', 'chapters', refused + failed > 0 ? 'attention' : 'portrait'],
      },
    ]
  },
}
