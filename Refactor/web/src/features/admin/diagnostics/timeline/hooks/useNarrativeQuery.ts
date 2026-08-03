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
    initial?.period ?? { preset: '1h', fromMs: null, toMs: null },
  )
  const [granularity, setGranularity] = useState<NarrativeGranularity>(initial?.granularity ?? 'chapters+spans')
  const [layers, setLayers] = useState<NarrativeLayers>(initial?.layers ?? { ...LAYERS_DEFAULT })
  const [filters, setFilters] = useState<ReadingFilters>(
    initial?.filters ?? { domains: [], severities: [], search: '' },
  )
  const [rawEvents, setRawEvents] = useState<DiagnosticsEventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasEarlier, setHasEarlier] = useState(true)
  const [windowTruncated, setWindowTruncated] = useState(false)
  const [latestSequence, setLatestSequence] = useState<number | null>(null)
  const earliestLoadedMs = useRef<number | null>(null)
  const oldestSequence = useRef<number | null>(null)

  const loadWindow = useCallback(
    async (fromMs: number, toMs: number, mode: 'replace' | 'prepend' | 'append') => {
      const sessionId = sessionIdFromScope(scope)
      const result = await fetchTimeline({
        since: new Date(fromMs).toISOString(),
        until: new Date(toMs).toISOString(),
        sessionId,
        limit: PAGE_LIMIT,
        beforeSequence: mode === 'prepend' ? (oldestSequence.current ?? undefined) : undefined,
      })
      const events = journalPageToNarrativeEvents(result.items)

      if (mode === 'replace') {
        setRawEvents(events)
        oldestSequence.current = result.nextBeforeSequence
        setLatestSequence(result.latestSequence)
        setWindowTruncated(result.truncated)
      } else if (mode === 'prepend') {
        setRawEvents((prev) => mergeById(events, prev))
        if (result.nextBeforeSequence != null) oldestSequence.current = result.nextBeforeSequence
        setWindowTruncated((prev) => prev || result.truncated)
      } else {
        setRawEvents((prev) => mergeById(prev, events))
        if (result.latestSequence != null) {
          setLatestSequence((prev) =>
            prev == null ? result.latestSequence : Math.max(prev, result.latestSequence!),
          )
        }
      }

      const minMs = events.reduce((m, e) => Math.min(m, Date.parse(e.utc)), Number.POSITIVE_INFINITY)
      if (Number.isFinite(minMs)) {
        earliestLoadedMs.current =
          earliestLoadedMs.current == null ? minMs : Math.min(earliestLoadedMs.current, minMs)
      }
      return { events, truncated: result.truncated, nextBefore: result.nextBeforeSequence }
    },
    [scope],
  )

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    earliestLoadedMs.current = null
    oldestSequence.current = null
    setLatestSequence(null)
    try {
      const { fromMs, toMs } = resolvePeriodBounds(period)
      const { truncated, nextBefore } = await loadWindow(fromMs, toMs, 'replace')
      setHasEarlier(period.preset !== 'all' || truncated || nextBefore != null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load narrative events')
      setRawEvents([])
    } finally {
      setLoading(false)
    }
  }, [loadWindow, period])

  useEffect(() => {
    void reload()
  }, [reload])

  const loadEarlier = useCallback(async () => {
    if (!hasEarlier || loadingEarlier) return
    setLoadingEarlier(true)
    try {
      const { fromMs, toMs } = resolvePeriodBounds(period)
      const anchor = earliestLoadedMs.current ?? fromMs
      const sliceMs = 60 * 60_000
      const sliceTo = Math.max(fromMs, anchor - 1)
      const sliceFrom = Math.max(fromMs, sliceTo - sliceMs)
      const { events, nextBefore } = await loadWindow(sliceFrom, toMs, 'prepend')
      if (events.length === 0 && nextBefore == null) setHasEarlier(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load earlier events')
    } finally {
      setLoadingEarlier(false)
    }
  }, [hasEarlier, loadingEarlier, loadWindow, period])

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
    // Journal query applies since/until server-side; suppress legacy client-until coaching.
    return {
      ...built,
      completeness: {
        filteredUntilClient: false,
        note: windowTruncated
          ? 'Journal window truncated — refine scope/period or load earlier for a fuller story.'
          : null,
      },
    }
  }, [rawEvents, scope, period, filters, windowTruncated])

  const visibleLanes = useMemo(() => {
    if (layers.systemLane) return narrative.lanes
    return narrative.lanes.filter((l) => l.kind !== 'system')
  }, [narrative.lanes, layers.systemLane])

  return {
    scope,
    setScope,
    period,
    setPeriod,
    granularity,
    setGranularity,
    layers,
    setLayers,
    filters,
    setFilters,
    narrative: { ...narrative, lanes: visibleLanes },
    rawEvents,
    loading,
    loadingEarlier,
    error,
    reload,
    loadEarlier,
    hasEarlier,
    appendEvents,
    applyReadingFilters,
    latestSequence,
  }
}

export { LAYERS_DEFAULT as DEFAULT_NARRATIVE_LAYERS }
