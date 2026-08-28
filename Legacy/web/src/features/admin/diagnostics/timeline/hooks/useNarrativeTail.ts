import { useEffect, useRef } from 'react'
import { diagnosticsApi, type DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import type { NarrativeScope } from '../model/narrativeTypes'

interface UseNarrativeTailOptions {
  enabled: boolean
  scope: NarrativeScope
  /** Latest event utc currently loaded — tail fetches since this. */
  sinceUtc: string | null
  onEvents: (events: DiagnosticsEventRecord[]) => void
  intervalMs?: number
}

/**
 * Polls for newer events and appends them. Dedup is the caller's responsibility (mergeById).
 */
export function useNarrativeTail({
  enabled,
  scope,
  sinceUtc,
  onEvents,
  intervalMs = 8_000,
}: UseNarrativeTailOptions) {
  const sinceRef = useRef(sinceUtc)
  sinceRef.current = sinceUtc

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const tick = async () => {
      const since = sinceRef.current
      if (!since) return
      try {
        const connectionId = scope.kind === 'session' ? scope.connectionId : undefined
        const events = connectionId
          ? await diagnosticsApi.getSessionEvents(connectionId, since)
          : await diagnosticsApi.listEvents({ since, connectionId })
        if (cancelled || events.length === 0) return
        // Drop the boundary event that matches `since` exactly if already known
        const fresh = events.filter((e) => e.utc > since)
        if (fresh.length > 0) onEvents(fresh)
      } catch {
        /* tail is best-effort */
      }
    }

    const id = window.setInterval(() => { void tick() }, intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [enabled, scope, onEvents, intervalMs])
}
