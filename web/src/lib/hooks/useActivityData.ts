import { useCallback, useEffect, useState } from 'react'
import { diagnosticsApi, type DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

export interface ActivityFilters {
  search: string
  domains: string[]
  severities: string[]
  timeWindow: string
  connectionId: string
  sort: 'newest' | 'oldest' | 'severity'
}

export const DEFAULT_FILTERS: ActivityFilters = {
  search: '',
  domains: [],
  severities: [],
  timeWindow: '1h',
  connectionId: '',
  sort: 'newest',
}

const TIME_WINDOWS: Record<string, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  all: 0,
}

const SEVERITY_ORDER: Record<string, number> = { Error: 0, Warning: 1, Info: 2, Information: 2, Metric: 3 }

export function useActivityData(filters: ActivityFilters) {
  const [allEvents, setAllEvents] = useState<DiagnosticsEventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sinceMs = TIME_WINDOWS[filters.timeWindow] ?? 0
      const since = sinceMs > 0 ? new Date(Date.now() - sinceMs).toISOString() : undefined
      const namePrefix = filters.search && !filters.search.includes(' ') ? filters.search : undefined
      const raw = await diagnosticsApi.listEvents({
        since,
        namePrefix,
        connectionId: filters.connectionId || undefined,
      })
      setAllEvents(raw)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load events')
      setAllEvents([])
    } finally {
      setLoading(false)
    }
  }, [filters.timeWindow, filters.search, filters.connectionId])

  useEffect(() => {
    void fetch()
  }, [fetch])

  const filtered = allEvents.filter((e) => {
    if (filters.domains.length > 0 && !filters.domains.includes(e.domain)) return false
    if (filters.severities.length > 0 && !filters.severities.includes(e.severity)) return false
    if (filters.search && filters.search.includes(' ')) {
      const terms = filters.search.toLowerCase().split(/\s+/)
      const text = `${e.name} ${e.domain} ${e.severity}`.toLowerCase()
      if (!terms.every((t) => text.includes(t))) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    if (filters.sort === 'oldest') return a.utc.localeCompare(b.utc)
    if (filters.sort === 'severity') return (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    return b.utc.localeCompare(a.utc)
  })

  return { events: sorted, loading, error, refresh: fetch }
}
