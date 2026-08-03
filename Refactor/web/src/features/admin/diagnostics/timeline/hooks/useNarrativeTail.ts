import { useEffect, useRef } from 'react'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { fetchTimeline, journalPageToNarrativeEvents } from '@/lib/timelineApi'
import type { NarrativeScope } from '../model/narrativeTypes'

interface UseNarrativeTailOptions {
  enabled: boolean
  scope: NarrativeScope
  /** Latest Journal sequence currently loaded — tail fetches after this. */
  afterSequence: number | null
  onEvents: (events: DiagnosticsEventRecord[]) => void
  intervalMs?: number
}

/**
 * Polls Journal for newer sequences and appends them.
 * Dedup is the caller's responsibility (mergeById).
 */
export function useNarrativeTail({
  enabled,
  scope,
  afterSequence,
  onEvents,
  intervalMs = 5_000,
}: UseNarrativeTailOptions) {
  const afterRef = useRef(afterSequence)
  afterRef.current = afterSequence

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const tick = async () => {
      const after = afterRef.current
      // Wait until the initial window has a sequence anchor — avoid replaying the full page.
      if (after == null) return
      try {
        const sessionId = scope.kind === 'session' ? scope.connectionId : undefined
        const result = await fetchTimeline({
          sessionId,
          afterSequence: after,
          limit: 100,
        })
        if (cancelled || result.items.length === 0) return
        const events = journalPageToNarrativeEvents(result.items).filter(
          (e) => typeof e.seq === 'number' && e.seq > after,
        )
        if (events.length > 0) onEvents(events)
      } catch {
        /* tail is best-effort */
      }
    }

    const id = window.setInterval(() => {
      void tick()
    }, intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [enabled, scope, onEvents, intervalMs])
}
