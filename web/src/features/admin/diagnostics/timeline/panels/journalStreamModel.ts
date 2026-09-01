import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { eventTone, type EventTone } from '../model/eventSemantics'
import { shortEventLabel } from './chapterSheetModel'

/** Independent grouping toggles — each folds correlated facts; the rest stay loose. */
export type JournalGroupingOptions = {
  groupSessionFacts: boolean
}

export const DEFAULT_JOURNAL_GROUPING: JournalGroupingOptions = {
  groupSessionFacts: true,
}

export interface JournalSessionGroup {
  key: string
  sessionId: string
  title: string
  /** First (oldest) event time — chronological anchor for the mixed list. */
  anchorMs: number
  endMs: number
  events: DiagnosticsEventRecord[]
  listEvents: Array<{ event: DiagnosticsEventRecord; runCount: number }>
  faultCount: number
  warningCount: number
  outcome: string
  tone: EventTone
}

export type JournalStreamItem =
  | { kind: 'fact'; sortMs: number; event: DiagnosticsEventRecord; runCount: number }
  | { kind: 'group'; sortMs: number; group: JournalSessionGroup }

function eventMs(e: DiagnosticsEventRecord): number {
  const t = Date.parse(e.utc)
  return Number.isFinite(t) ? t : 0
}

function compareNewestFirst(a: DiagnosticsEventRecord, b: DiagnosticsEventRecord): number {
  const sa = a.seq
  const sb = b.seq
  if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb) return sb - sa
  return eventMs(b) - eventMs(a) || b.id.localeCompare(a.id)
}

function compareOldestFirst(a: DiagnosticsEventRecord, b: DiagnosticsEventRecord): number {
  return -compareNewestFirst(a, b)
}

/** Collapse consecutive identical SampleCollected (list is newest-first). */
export function collapseSampleRuns(
  orderedNewestFirst: DiagnosticsEventRecord[],
): Array<{ event: DiagnosticsEventRecord; runCount: number }> {
  const out: Array<{ event: DiagnosticsEventRecord; runCount: number }> = []
  for (const event of orderedNewestFirst) {
    const isSample = /SampleCollected/i.test(event.name)
    const prev = out[out.length - 1]
    if (isSample && prev && /SampleCollected/i.test(prev.event.name) && prev.event.domain === event.domain) {
      prev.runCount += 1
      continue
    }
    out.push({ event, runCount: 1 })
  }
  return out
}

function payloadReason(event: DiagnosticsEventRecord): string | null {
  const p = event.payload as Record<string, unknown> | null
  return p && typeof p.reason === 'string' ? p.reason : null
}

function sessionOutcome(eventsOldestFirst: DiagnosticsEventRecord[]): { outcome: string; tone: EventTone } {
  const faults = eventsOldestFirst.filter((e) => eventTone(e) === 'fault')
  if (faults.length > 0) {
    return { outcome: shortEventLabel(faults[faults.length - 1].name), tone: 'fault' }
  }
  const timedOut = [...eventsOldestFirst].reverse().find((e) => /SessionTimedOut$/i.test(e.name))
  if (timedOut) return { outcome: 'Timed out', tone: 'lifecycle' }
  const stopped = [...eventsOldestFirst].reverse().find((e) => /SessionStopped$/i.test(e.name))
  if (stopped) {
    const reason = payloadReason(stopped)
    return { outcome: reason ? `Stopped · ${reason}` : 'Stopped', tone: 'lifecycle' }
  }
  const started = eventsOldestFirst.some((e) => /SessionStarted$/i.test(e.name))
  if (started) return { outcome: 'Live / in progress', tone: 'lifecycle' }
  const starting = eventsOldestFirst.some((e) => /SessionStarting$/i.test(e.name))
  if (starting) return { outcome: 'Starting', tone: 'lifecycle' }
  const last = eventsOldestFirst[eventsOldestFirst.length - 1]
  return { outcome: last ? shortEventLabel(last.name) : 'Activity', tone: last ? eventTone(last) : 'info' }
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}

function buildSessionGroup(sessionId: string, events: DiagnosticsEventRecord[]): JournalSessionGroup {
  const oldestFirst = [...events].sort(compareOldestFirst)
  const newestFirst = [...events].sort(compareNewestFirst)
  const { outcome, tone } = sessionOutcome(oldestFirst)
  return {
    key: `sess:${sessionId}`,
    sessionId,
    title: `Session ${shortId(sessionId)}`,
    anchorMs: eventMs(oldestFirst[0]),
    endMs: eventMs(oldestFirst[oldestFirst.length - 1]),
    events: oldestFirst,
    listEvents: collapseSampleRuns(newestFirst),
    faultCount: events.filter((e) => eventTone(e) === 'fault').length,
    warningCount: events.filter((e) => eventTone(e) === 'warning').length,
    outcome,
    tone,
  }
}

export type JournalSortOrder = 'newest' | 'oldest'

/**
 * Chronological mixed stream: optional session groups (anchor = first event) interleaved
 * with loose facts. Domain / platform are never force-bucketed.
 */
export function buildMixedJournalStream(
  events: DiagnosticsEventRecord[],
  grouping: JournalGroupingOptions,
  sortOrder: JournalSortOrder = 'newest',
): JournalStreamItem[] {
  const sessionBuckets = new Map<string, DiagnosticsEventRecord[]>()
  const loose: DiagnosticsEventRecord[] = []

  for (const event of events) {
    if (grouping.groupSessionFacts && event.connectionId) {
      const list = sessionBuckets.get(event.connectionId)
      if (list) list.push(event)
      else sessionBuckets.set(event.connectionId, [event])
    } else {
      loose.push(event)
    }
  }

  const items: JournalStreamItem[] = []

  for (const [sessionId, evs] of sessionBuckets) {
    // A lone session fact stays loose — grouping only pays off for correlated runs.
    if (evs.length < 2) {
      loose.push(...evs)
      continue
    }
    const group = buildSessionGroup(sessionId, evs)
    items.push({ kind: 'group', sortMs: group.anchorMs, group })
  }

  // Loose facts stay individual in the mixed timeline (no cross-time sample collapse).
  for (const event of loose) {
    items.push({ kind: 'fact', sortMs: eventMs(event), event, runCount: 1 })
  }

  const dir = sortOrder === 'newest' ? -1 : 1
  return items.sort((a, b) => dir * (a.sortMs - b.sortMs) || a.kind.localeCompare(b.kind))
}

export function formatDurationShort(startMs: number, endMs: number): string {
  const ms = Math.max(0, endMs - startMs)
  if (ms < 1000) return '<1s'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export function formatChapterWhen(startMs: number): string {
  return new Date(startMs).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** @deprecated kept for any residual imports — prefer JournalGroupingOptions */
export type JournalGroupBy = 'none' | 'domain' | 'session'
