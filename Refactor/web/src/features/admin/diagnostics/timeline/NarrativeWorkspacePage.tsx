import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { w7sPath } from '@/lib/w7s'
import { useNarrativeQuery } from './hooks/useNarrativeQuery'
import { useNarrativeTail } from './hooks/useNarrativeTail'
import { useNarrativeSelection } from './hooks/useNarrativeSelection'
import { ReadingStrip } from './reading/ReadingStrip'
import { NarrativeCanvas, type NarrativeCanvasHandle } from './canvas/NarrativeCanvas'
import { NarrativeInspector } from './panels/NarrativeInspector'
import { AttentionStrip } from './panels/AttentionStrip'
import { JournalEventStream } from './panels/JournalEventStream'
import { JournalFactDetail } from './panels/JournalFactDetail'
import { resolvePeriodBounds } from './model/buildNarrative'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

export default function NarrativeWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const connectionId = searchParams.get('connectionId') ?? searchParams.get('sessionId')
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const canvasRef = useRef<NarrativeCanvasHandle>(null)
  const [mapOpen, setMapOpen] = useState(false)

  const initialPeriod =
    fromParam && toParam && Number.isFinite(Date.parse(fromParam)) && Number.isFinite(Date.parse(toParam))
      ? { preset: 'custom' as const, fromMs: Date.parse(fromParam), toMs: Date.parse(toParam) }
      : undefined

  const query = useNarrativeQuery({
    scope: connectionId ? { kind: 'session', connectionId } : { kind: 'platform' },
    period: initialPeriod,
  })

  useEffect(() => {
    if (connectionId) {
      query.setScope({ kind: 'session', connectionId })
    }
  }, [connectionId]) // eslint-disable-line react-hooks/exhaustive-deps -- sync URL → scope once per param change

  const selection = useNarrativeSelection()

  useNarrativeTail({
    enabled: query.layers.liveTail,
    scope: query.scope,
    afterSequence: query.latestSequence,
    onEvents: query.appendEvents,
  })

  const onScopeChange = useCallback(
    (scope: typeof query.scope) => {
      query.setScope(scope)
      setSearchParams(
        (p) => {
          if (scope.kind === 'session') {
            p.set('sessionId', scope.connectionId)
            p.delete('connectionId')
          } else {
            p.delete('sessionId')
            p.delete('connectionId')
          }
          return p
        },
        { replace: true },
      )
    },
    [query, setSearchParams],
  )

  const analysisHref = useMemo(() => {
    const { fromMs, toMs } = resolvePeriodBounds(query.period)
    const q = new URLSearchParams()
    q.set('from', new Date(fromMs).toISOString())
    q.set('to', new Date(toMs).toISOString())
    if (query.scope.kind === 'session') q.set('sessionId', query.scope.connectionId)
    return w7sPath(`/admin/diagnostics/investigate?${q.toString()}`)
  }, [query.period, query.scope])

  const jumpToMs = useCallback((ms: number) => {
    setMapOpen(true)
    requestAnimationFrame(() => canvasRef.current?.jumpToMs(ms))
  }, [])

  const flatEvents = useMemo(
    () => query.narrative.chapters.flatMap((c) => c.beats.map((b) => b.event)),
    [query.narrative.chapters],
  )

  // Prefer chapter beat list from narrative clusters order if chapters empty but eventCount > 0
  const streamEvents = useMemo(() => {
    if (flatEvents.length > 0) return flatEvents
    return query.narrative.clusters.flatMap((c) => c.beats.map((b) => b.event))
  }, [flatEvents, query.narrative.clusters])

  const selectedEvent: DiagnosticsEventRecord | null =
    selection.selection?.kind === 'beat'
      ? selection.selection.beat.event
      : selection.selection?.kind === 'cluster'
        ? selection.selection.cluster.beats[0]?.event ?? null
        : null

  const onSelectEvent = useCallback(
    (event: DiagnosticsEventRecord) => {
      selection.selectBeat({ event, ms: Date.parse(event.utc), clusterKey: null })
      requestAnimationFrame(() => {
        document.getElementById('journal-fact')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    },
    [selection],
  )

  const onSelectChapter = useCallback(
    (chapter: Parameters<typeof selection.selectChapter>[0]) => {
      selection.selectChapter(chapter)
      setMapOpen(true)
      canvasRef.current?.fit()
      canvasRef.current?.jumpToMs(chapter.startMs + chapter.durationMs / 2)
      const span = Math.max(chapter.durationMs, 1)
      if (span < 5 * 60_000) {
        for (let i = 0; i < 4; i++) canvasRef.current?.zoomIn()
        canvasRef.current?.jumpToMs(chapter.startMs + chapter.durationMs / 2)
      }
    },
    [selection],
  )

  const hasSelection = selection.selection != null

  useEffect(() => {
    if (!hasSelection) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') selection.clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasSelection, selection])

  // Auto-select latest fact so the detail pane is ready for debug.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (autoOpenedRef.current || query.loading || streamEvents.length === 0) return
    autoOpenedRef.current = true
    const latest = [...streamEvents].sort((a, b) => {
      const sa = a.seq ?? 0
      const sb = b.seq ?? 0
      if (sa !== sb) return sb - sa
      return Date.parse(b.utc) - Date.parse(a.utc)
    })[0]
    if (latest) onSelectEvent(latest)
  }, [query.loading, streamEvents, onSelectEvent])

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2.5 pb-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="text-base font-semibold tracking-tight md:text-lg">Journal</h1>
        <p className="text-[11px] text-muted-foreground">
          Durable diagnostic facts · filter · inspect payload · Esc clears
        </p>
      </div>

      <ReadingStrip
        scope={query.scope}
        onScopeChange={onScopeChange}
        period={query.period}
        onPeriodChange={query.setPeriod}
        granularity={query.granularity}
        onGranularityChange={query.setGranularity}
        layers={query.layers}
        onLayersChange={query.setLayers}
        filters={query.filters}
        onFiltersChange={query.setFilters}
        onRefresh={() => void query.reload()}
        analysisHref={analysisHref}
        stats={{
          beats: query.narrative.eventCount,
          lanes: query.narrative.lanes.length,
          chapters: query.narrative.chapters.length,
        }}
        onZoomIn={() => {
          setMapOpen(true)
          canvasRef.current?.zoomIn()
        }}
        onZoomOut={() => {
          setMapOpen(true)
          canvasRef.current?.zoomOut()
        }}
        onFit={() => {
          setMapOpen(true)
          canvasRef.current?.fit()
        }}
      />

      {query.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {query.error}
          <button type="button" className="ml-3 underline" onClick={() => void query.reload()}>
            Retry
          </button>
        </div>
      )}

      {query.narrative.completeness.note && !query.loading && (
        <p className="text-xs text-muted-foreground">{query.narrative.completeness.note}</p>
      )}

      {!query.loading && (
        <AttentionStrip
          chapters={query.narrative.chapters}
          selectedKey={selection.selection?.kind === 'chapter' ? selection.selection.chapter.key : null}
          onSelect={onSelectChapter}
        />
      )}

      <div className="rounded-xl border border-border bg-card">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/20"
          aria-expanded={mapOpen}
          onClick={() => setMapOpen((v) => !v)}
        >
          Time context map
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', mapOpen && 'rotate-180')} />
        </button>
        {mapOpen &&
          (query.loading ? (
            <Skeleton className="mx-3 mb-3 h-[180px] rounded-lg" />
          ) : (
            <div className="border-t border-border/40 px-1 pb-2">
              <NarrativeCanvas
                ref={canvasRef}
                narrative={query.narrative}
                granularity={query.granularity}
                layers={query.layers}
                highlightChapterKey={selection.highlightChapterKey}
                highlightSpanIds={selection.highlightSpanIds}
                onSelectChapter={onSelectChapter}
                onHoverChapter={(c) =>
                  selection.hoverChapter(c?.key ?? null, c?.spans.map((s) => s.spanId) ?? [])
                }
                onSelectCluster={selection.selectCluster}
                onSelectLane={selection.selectLane}
                onLoadEarlier={() => void query.loadEarlier()}
                hasEarlier={query.hasEarlier}
                loadingEarlier={query.loadingEarlier}
              />
            </div>
          ))}
        {!mapOpen && !query.loading && query.hasEarlier && (
          <div className="border-t border-border/40 px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              disabled={query.loadingEarlier}
              onClick={() => void query.loadEarlier()}
            >
              {query.loadingEarlier ? 'Loading earlier…' : 'Load earlier facts'}
            </Button>
          </div>
        )}
      </div>

      {query.loading ? (
        <Skeleton className="h-[320px] w-full rounded-xl" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] lg:items-start">
          <JournalEventStream
            events={streamEvents}
            selectedId={selectedEvent?.id ?? null}
            onSelect={onSelectEvent}
          />
          <div className="lg:sticky lg:top-2">
            {selectedEvent ? (
              <JournalFactDetail event={selectedEvent} onClose={selection.clear} onJumpToMs={jumpToMs} />
            ) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                Select a journal fact to inspect payload, seq, and correlation.
              </div>
            )}
          </div>
        </div>
      )}

      {selection.selection?.kind === 'chapter' && (
        <NarrativeInspector selection={selection.selection} onClose={selection.clear} onJumpToMs={jumpToMs} />
      )}
    </div>
  )
}
