import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import {
  fetchTimeline,
  journalPageToNarrativeEvents,
} from '@/lib/timelineApi'
import {
  applyReadingFilters,
  buildNarrative,
  resolvePeriodBounds,
} from '../model/buildNarrative'
import { DEFAULT_JOURNAL_SOURCE_FILTERS } from '../model/journalSources'
import type {
  Narrative,
  NarrativeGranularity,
  NarrativeLayers,
  NarrativePeriod,
  NarrativeScope,
  ReadingFilters,
} from '../model/narrativeTypes'
import { DEFAULT_LAYERS as LAYERS_DEFAULT } from '../model/narrativeTypes'

export type { NarrativePeriod, NarrativeScope, NarrativeLayers, NarrativeGranularity, ReadingFilters }

export interface NarrativeQueryState {
  scope: NarrativeScope
  period: NarrativePeriod
  granularity: NarrativeGranularity
  layers: NarrativeLayers
  filters: ReadingFilters
}

const PAGE_LIMIT = 500
/** Safety cap so a huge window cannot loop forever. */
const MAX_PAGES = 40

function mergeById(existing: DiagnosticsEventRecord[], incoming: DiagnosticsEventRecord[]): DiagnosticsEventRecord[] {
  const map = new Map<string, DiagnosticsEventRecord>()
  for (const e of existing) map.set(e.id, e)
  for (const e of incoming) map.set(e.id, e)
  return [...map.values()].sort((a, b) => {
    const sa = a.seq
    const sb = b.seq
    if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb) return sa - sb
    return a.utc.localeCompare(b.utc) || a.id.localeCompare(b.id)
  })
}

function sessionIdFromScope(scope: NarrativeScope): string | undefined {
  return scope.kind === 'session' ? scope.connectionId : undefined
}

export function useNarrativeQuery(initial?: Partial<NarrativeQueryState>) {
  const [scope, setScope] = useState<NarrativeScope>(initial?.scope ?? { kind: 'platform' })
  const [period, setPeriod] = useState<NarrativePeriod>(
    initial?.period ?? { preset: '6h', fromMs: null, toMs: null },
  )
  const [granularity, setGranularity] = useState<NarrativeGranularity>(initial?.granularity ?? 'chapters+spans')
  const [layers, setLayers] = useState<NarrativeLayers>(initial?.layers ?? { ...LAYERS_DEFAULT })
  const [filters, setFilters] = useState<ReadingFilters>(
    // Real Journal sources — hide noisy samples by default.
    initial?.filters ?? {
      domains: [...DEFAULT_JOURNAL_SOURCE_FILTERS],
      severities: [],
      search: '',
    },
  )
  const [rawEvents, setRawEvents] = useState<DiagnosticsEventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowTruncated, setWindowTruncated] = useState(false)
  const [latestSequence, setLatestSequence] = useState<number | null>(null)
  const cancelGen = useRef(0)

  const reload = useCallback(async () => {
    const gen = ++cancelGen.current
    setLoading(true)
    setError(null)
    setLatestSequence(null)
    try {
      const { fromMs, toMs } = resolvePeriodBounds(period)
      const sessionId = sessionIdFromScope(scope)
      const since = new Date(fromMs).toISOString()
      const until = new Date(toMs).toISOString()

      let merged: DiagnosticsEventRecord[] = []
      let beforeSequence: number | undefined
      let truncated = false
      let latest: number | null = null

      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await fetchTimeline({
          since,
          until,
          sessionId,
          limit: PAGE_LIMIT,
          beforeSequence,
        })
        if (gen !== cancelGen.current) return

        const events = journalPageToNarrativeEvents(result.items)
        merged = mergeById(merged, events)
        if (result.latestSequence != null) {
          latest = latest == null ? result.latestSequence : Math.max(latest, result.latestSequence)
        }
        truncated = truncated || result.truncated

        if (result.nextBeforeSequence == null || events.length === 0) {
          truncated = false
          break
        }
        if (!result.truncated && events.length < PAGE_LIMIT) {
          truncated = false
          break
        }
        beforeSequence = result.nextBeforeSequence
      }

      if (gen !== cancelGen.current) return
      setRawEvents(merged)
      setLatestSequence(latest)
      setWindowTruncated(truncated)
    } catch (e: unknown) {
      if (gen !== cancelGen.current) return
      setError(e instanceof Error ? e.message : 'Failed to load journal facts')
      setRawEvents([])
    } finally {
      if (gen === cancelGen.current) setLoading(false)
    }
  }, [scope, period])

  useEffect(() => {
    void reload()
  }, [reload])

  const appendEvents = useCallback((incoming: DiagnosticsEventRecord[]) => {
    if (incoming.length === 0) return
    setRawEvents((prev) => mergeById(prev, incoming))
    let maxSeq: number | null = null
    for (const e of incoming) {
      if (typeof e.seq === 'number') maxSeq = maxSeq == null ? e.seq : Math.max(maxSeq, e.seq)
    }
    if (maxSeq != null) {
      setLatestSequence((prev) => (prev == null ? maxSeq : Math.max(prev, maxSeq)))
    }
  }, [])

  const narrative: Narrative = useMemo(() => {
    const built = buildNarrative({
      events: rawEvents,
      scope,
      period,
      filters,
      untilAppliedClientSide: false,
    })
    return {
      ...built,
      completeness: {
        filteredUntilClient: false,
        note: windowTruncated
          ? 'Time window hit the page safety cap — narrow the range if facts look incomplete.'
          : null,
      },
    }
  }, [rawEvents, scope, period, filters, windowTruncated])

  const visibleLanes = useMemo(() => {
    if (layers.systemLane) return narrative.lanes
    return narrative.lanes.filter((l) => l.kind !== 'system')
  }, [narrative.lanes, layers.systemLane])

  const setScopeAndLoad = useCallback((next: NarrativeScope) => {
    setLoading(true)
    setScope(next)
  }, [])

  const setPeriodAndLoad = useCallback((next: NarrativePeriod) => {
    setLoading(true)
    setPeriod(next)
  }, [])

  return {
    scope,
    setScope: setScopeAndLoad,
    period,
    setPeriod: setPeriodAndLoad,
    granularity,
    setGranularity,
    layers,
    setLayers,
    filters,
    setFilters,
    narrative: { ...narrative, lanes: visibleLanes },
    rawEvents,
    loading,
    error,
    reload,
    appendEvents,
    applyReadingFilters,
    latestSequence,
    windowTruncated,
  }
}

export { LAYERS_DEFAULT as DEFAULT_NARRATIVE_LAYERS }
