import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { diagnosticsApi, type DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
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

function mergeById(existing: DiagnosticsEventRecord[], incoming: DiagnosticsEventRecord[]): DiagnosticsEventRecord[] {
  const map = new Map<string, DiagnosticsEventRecord>()
  for (const e of existing) map.set(e.id, e)
  for (const e of incoming) map.set(e.id, e)
  return [...map.values()].sort((a, b) => a.utc.localeCompare(b.utc))
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
  const earliestLoadedMs = useRef<number | null>(null)
  const untilSupported = useRef(true)

  const loadWindow = useCallback(async (fromMs: number, toMs: number, mode: 'replace' | 'prepend' | 'append') => {
    const since = new Date(fromMs).toISOString()
    const until = new Date(toMs).toISOString()
    const connectionId = scope.kind === 'session' ? scope.connectionId : undefined

    let events: DiagnosticsEventRecord[]
    try {
      if (connectionId) {
        events = await diagnosticsApi.getSessionEvents(connectionId, since, undefined, until)
      } else {
        events = await diagnosticsApi.listEvents({ since, until, connectionId })
      }
      untilSupported.current = true
    } catch {
      // Fallback when until= is not yet on the server
      untilSupported.current = false
      if (connectionId) {
        events = await diagnosticsApi.getSessionEvents(connectionId, since)
      } else {
        events = await diagnosticsApi.listEvents({ since, connectionId })
      }
      events = events.filter((e) => {
        const t = Date.parse(e.utc)
        return t >= fromMs && t <= toMs
      })
    }

    if (mode === 'replace') {
      setRawEvents(events)
    } else if (mode === 'prepend') {
      setRawEvents((prev) => mergeById(events, prev))
    } else {
      setRawEvents((prev) => mergeById(prev, events))
    }

    const minMs = events.reduce((m, e) => Math.min(m, Date.parse(e.utc)), Number.POSITIVE_INFINITY)
    if (Number.isFinite(minMs)) {
      earliestLoadedMs.current = earliestLoadedMs.current == null
        ? minMs
        : Math.min(earliestLoadedMs.current, minMs)
    }
    return events
  }, [scope])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    earliestLoadedMs.current = null
    try {
      const { fromMs, toMs } = resolvePeriodBounds(period)
      await loadWindow(fromMs, toMs, 'replace')
      setHasEarlier(period.preset !== 'all')
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
      const anchor = earliestLoadedMs.current ?? resolvePeriodBounds(period).fromMs
      const sliceMs = 60 * 60_000
      const toMs = anchor - 1
      const fromMs = toMs - sliceMs
      const events = await loadWindow(fromMs, toMs, 'prepend')
      if (events.length === 0) setHasEarlier(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load earlier events')
    } finally {
      setLoadingEarlier(false)
    }
  }, [hasEarlier, loadingEarlier, loadWindow, period])

  const appendEvents = useCallback((incoming: DiagnosticsEventRecord[]) => {
    if (incoming.length === 0) return
    setRawEvents((prev) => mergeById(prev, incoming))
  }, [])

  const narrative: Narrative = useMemo(
    () =>
      buildNarrative({
        events: rawEvents,
        scope,
        period,
        filters,
        untilAppliedClientSide: !untilSupported.current,
      }),
    [rawEvents, scope, period, filters],
  )

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
  }
}

export { LAYERS_DEFAULT as DEFAULT_NARRATIVE_LAYERS }
