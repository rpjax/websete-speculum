import { useMemo } from 'react'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { detectStoryType, type StoryType } from '@/lib/diagnosticsConstants'

export interface CorrelationStory {
  correlationId: string
  type: StoryType
  events: DiagnosticsEventRecord[]
  connectionId: string | null
  latestUtc: string
  earliestUtc: string
  durationMs: number
}

export interface GroupedActivity {
  stories: CorrelationStory[]
  uncorrelated: DiagnosticsEventRecord[]
}

export function groupEventsIntoStories(events: DiagnosticsEventRecord[]): GroupedActivity {
  const byCorrelation = new Map<string, DiagnosticsEventRecord[]>()
  const uncorrelated: DiagnosticsEventRecord[] = []

  for (const evt of events) {
    if (evt.correlationId) {
      const list = byCorrelation.get(evt.correlationId) ?? []
      list.push(evt)
      byCorrelation.set(evt.correlationId, list)
    } else {
      uncorrelated.push(evt)
    }
  }

  const stories: CorrelationStory[] = []
  for (const [correlationId, storyEvents] of byCorrelation) {
    const sorted = storyEvents.sort((a, b) => a.utc.localeCompare(b.utc))
    const names = sorted.map((e) => e.name)
    const earliest = sorted[0].utc
    const latest = sorted[sorted.length - 1].utc
    stories.push({
      correlationId,
      type: detectStoryType(names),
      events: sorted,
      connectionId: sorted[0].connectionId ?? null,
      earliestUtc: earliest,
      latestUtc: latest,
      durationMs: new Date(latest).getTime() - new Date(earliest).getTime(),
    })
  }

  stories.sort((a, b) => b.latestUtc.localeCompare(a.latestUtc))

  return { stories, uncorrelated }
}

export interface SessionGroup {
  connectionId: string | null
  label: string
  events: DiagnosticsEventRecord[]
  stories: CorrelationStory[]
  uncorrelated: DiagnosticsEventRecord[]
}

export function groupEventsBySession(events: DiagnosticsEventRecord[]): SessionGroup[] {
  const bySession = new Map<string | null, DiagnosticsEventRecord[]>()

  for (const evt of events) {
    const key = evt.connectionId ?? null
    const list = bySession.get(key) ?? []
    list.push(evt)
    bySession.set(key, list)
  }

  const groups: SessionGroup[] = []
  for (const [connectionId, sessionEvents] of bySession) {
    const { stories, uncorrelated } = groupEventsIntoStories(sessionEvents)
    groups.push({
      connectionId,
      label: connectionId ? connectionId.slice(0, 16) + '...' : 'System events',
      events: sessionEvents,
      stories,
      uncorrelated,
    })
  }

  groups.sort((a, b) => {
    if (a.connectionId === null) return 1
    if (b.connectionId === null) return -1
    const aLatest = a.events[a.events.length - 1]?.utc ?? ''
    const bLatest = b.events[b.events.length - 1]?.utc ?? ''
    return bLatest.localeCompare(aLatest)
  })

  return groups
}

export function useCorrelationStories(events: DiagnosticsEventRecord[]) {
  return useMemo(() => groupEventsIntoStories(events), [events])
}

export function useSessionGroups(events: DiagnosticsEventRecord[]) {
  return useMemo(() => groupEventsBySession(events), [events])
}

export function extractStorySummary(story: CorrelationStory): Record<string, string> {
  const summary: Record<string, string> = {}
  const payloads = story.events.map((e) => e.payload as Record<string, unknown> | null).filter(Boolean)

  switch (story.type) {
    case 'session-lifecycle': {
      const started = payloads.find((p) => p?.restored !== undefined)
      if (started?.restored) summary['Restored'] = 'yes'
      if (typeof started?.cookieCount === 'number') summary['Cookies'] = String(started.cookieCount)
      if (typeof started?.persistedSessionId === 'string') summary['Session'] = (started.persistedSessionId as string).slice(0, 12) + '...'
      const failed = story.events.find((e) => e.name.includes('Failed'))
      if (failed) {
        const fp = failed.payload as Record<string, unknown> | null
        if (fp?.errorCode) summary['Error'] = String(fp.errorCode)
      }
      break
    }
    case 'navigation': {
      const nav = payloads.find((p) => p?.targetUrl)
      if (nav?.targetUrl) summary['URL'] = String(nav.targetUrl)
      const rejected = story.events.find((e) => e.name.includes('Rejected'))
      if (rejected) {
        const rp = rejected.payload as Record<string, unknown> | null
        if (rp?.errorCode) summary['Error'] = String(rp.errorCode)
      }
      break
    }
    case 'probe': {
      const probe = payloads.find((p) => Array.isArray(p?.ops))
      if (probe?.ops) summary['Ops'] = (probe.ops as string[]).join(', ')
      const failed = story.events.find((e) => e.name.includes('TimedOut') || e.name.includes('Rejected'))
      if (failed) {
        const fp = failed.payload as Record<string, unknown> | null
        if (fp?.errorCode) summary['Error'] = String(fp.errorCode)
      }
      break
    }
    case 'drain': {
      const drain = payloads.find((p) => p?.sessionCount !== undefined)
      if (drain?.sessionCount !== undefined) summary['Sessions'] = String(drain.sessionCount)
      if (drain?.sectionKey) summary['Trigger'] = String(drain.sectionKey)
      break
    }
    case 'state-export': {
      const exp = payloads.find((p) => p?.cookieCount !== undefined)
      if (exp?.cookieCount !== undefined) summary['Cookies'] = String(exp.cookieCount)
      if (exp?.localStorageCount !== undefined) summary['LocalStorage'] = String(exp.localStorageCount)
      break
    }
    case 'admin': {
      const admin = payloads.find((p) => p?.browserQueryFloor || p?.reason || p?.enabled !== undefined)
      if (admin?.browserQueryFloor) summary['Floor'] = String(admin.browserQueryFloor)
      if (admin?.minutes) summary['Duration'] = `${admin.minutes}m`
      if (admin?.reason) summary['Reason'] = String(admin.reason)
      break
    }
  }

  if (story.durationMs > 0) summary['Duration'] = story.durationMs < 1000 ? `${story.durationMs}ms` : `${(story.durationMs / 1000).toFixed(1)}s`

  return summary
}
