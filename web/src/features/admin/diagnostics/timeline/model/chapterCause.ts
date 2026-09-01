import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { describeEvent, describeErrorCode } from '@/lib/diagnosticsDescriptions'
import { shortEventLabel } from '../panels/chapterSheetModel'
import { eventTone, isFaultEvent, isNaturalLifecycleClose } from './eventSemantics'
import type { NarrativeChapter } from './narrativeTypes'

export interface ChapterCause {
  event: DiagnosticsEventRecord
  title: string
  detail: string
  kind: 'error' | 'timeout' | 'warning' | 'info' | 'lifecycle'
}

/** Pick the most useful operator-facing highlight for a chapter (faults first). */
export function resolveChapterCause(chapter: NarrativeChapter): ChapterCause | null {
  const beats = [...chapter.beats].sort((a, b) => b.ms - a.ms)
  const fault = beats.find((b) => isFaultEvent(b.event))
  const warning = beats.find((b) => b.event.severity === 'Warning' && !isNaturalLifecycleClose(b.event.name))
  const lifecycleClose = beats.find((b) => isNaturalLifecycleClose(b.event.name))
  const hit = fault ?? warning ?? lifecycleClose
  if (!hit) return null

  const evt = hit.event
  const payload = (evt.payload ?? null) as Record<string, unknown> | null
  const errorCode = typeof payload?.errorCode === 'string' ? payload.errorCode : null
  const reason = typeof payload?.reason === 'string' ? payload.reason : null

  if (isNaturalLifecycleClose(evt.name)) {
    return {
      event: evt,
      title: 'Session timed out (lifecycle close)',
      detail:
        reason === 'TimedOut' || !reason
          ? 'Natural end of collection: no client pipes remained before DetachedSessionTimeout. Not an operator fault.'
          : `Stop reason: ${reason}. Lifecycle close — not a fault.`,
      kind: 'lifecycle',
    }
  }

  if (errorCode) {
    const explained = describeErrorCode(errorCode)
    return {
      event: evt,
      title: explained.summary,
      detail: explained.detail,
      kind: 'error',
    }
  }

  const tone = eventTone(evt)
  return {
    event: evt,
    title: shortEventLabel(evt.name),
    detail: describeEvent(evt.name),
    kind: tone === 'warning' ? 'warning' : 'error',
  }
}

/** Lifecycle / fault beats worth showing without SampleCollected noise. */
export function salientBeats(chapter: NarrativeChapter) {
  return chapter.beats.filter((b) => {
    const n = b.event.name
    const sev = b.event.severity
    if (isFaultEvent(b.event) || sev === 'Warning') return true
    if (/SampleCollected|Metric/.test(n) && sev === 'Metric') return false
    return /Session|Browser|Connection|Navigate|Probe|Drain|Export|TimedOut|Failed|Starting|Started|Stopped|Stopping|Launched|Closed|Restored|Persisted/.test(
      n,
    )
  })
}
