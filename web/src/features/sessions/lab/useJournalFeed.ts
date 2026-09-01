import { useCallback, useEffect, useState } from 'react'
import type { JournalFact, SessionClient } from '@/lib/speculum'

export const JOURNAL_FEED_LIMIT = 200

export interface JournalFeed {
  facts: JournalFact[]
  error: string | null
  streaming: boolean
  clear: () => void
}

/**
 * Live view of Journal facts, parallel to the client-side event log: these come
 * from the API's Journal admission path, not from this browser's own actions.
 * Facts admitted before the subscription are not replayed.
 *
 * Incoming facts are batched per animation frame so high-rate trails (e.g.
 * InputApplied) do not force a React commit on every click/key.
 */
export function useJournalFeed(client: SessionClient, connected: boolean): JournalFeed {
  const [facts, setFacts] = useState<JournalFact[]>([])
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)

  useEffect(() => {
    if (!connected) {
      setStreaming(false)
      return
    }

    let active = true
    let pending: JournalFact[] = []
    let raf = 0
    setError(null)
    setStreaming(true)

    const flush = () => {
      raf = 0
      if (!active || pending.length === 0) {
        return
      }
      const batch = pending
      pending = []
      setFacts((previous) => [...batch.reverse(), ...previous].slice(0, JOURNAL_FEED_LIMIT))
    }

    let subscription: { dispose: () => void } | null = null
    try {
      subscription = client.streamJournalFacts({
        next: (fact) => {
          if (!active) {
            return
          }
          pending.push(fact)
          if (raf === 0) {
            raf = requestAnimationFrame(flush)
          }
        },
        error: (streamError) => {
          if (!active) {
            return
          }
          setStreaming(false)
          setError(streamError instanceof Error ? streamError.message : String(streamError))
        },
        complete: () => {
          if (active) {
            setStreaming(false)
          }
        },
      })
    } catch (subscribeError) {
      setStreaming(false)
      setError(
        subscribeError instanceof Error ? subscribeError.message : String(subscribeError),
      )
    }

    return () => {
      active = false
      setStreaming(false)
      if (raf !== 0) {
        cancelAnimationFrame(raf)
      }
      subscription?.dispose()
    }
  }, [client, connected])

  const clear = useCallback(() => setFacts([]), [])

  return { facts, error, streaming, clear }
}
