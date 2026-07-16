import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { useNarrativeQuery } from './hooks/useNarrativeQuery'
import { useNarrativeTail } from './hooks/useNarrativeTail'
import { useNarrativeSelection } from './hooks/useNarrativeSelection'
import { ReadingStrip } from './reading/ReadingStrip'
import { NarrativeCanvas, type NarrativeCanvasHandle } from './canvas/NarrativeCanvas'
import { ChapterSheet } from './panels/ChapterSheet'
import { BeatSheet } from './panels/BeatSheet'
import { SessionPeekSheet } from './panels/SessionPeekSheet'
import { resolvePeriodBounds } from './model/buildNarrative'

export default function NarrativeWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const connectionId = searchParams.get('connectionId')
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const canvasRef = useRef<NarrativeCanvasHandle>(null)

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

  const latestUtc = useMemo(() => {
    if (query.rawEvents.length === 0) return null
    return query.rawEvents.reduce((a, b) => (a.utc > b.utc ? a : b)).utc
  }, [query.rawEvents])

  useNarrativeTail({
    enabled: query.layers.liveTail,
    scope: query.scope,
    sinceUtc: latestUtc,
    onEvents: query.appendEvents,
  })

  const onScopeChange = useCallback(
    (scope: typeof query.scope) => {
      query.setScope(scope)
      setSearchParams(
        (p) => {
          if (scope.kind === 'session') p.set('connectionId', scope.connectionId)
          else p.delete('connectionId')
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
    if (query.scope.kind === 'session') q.set('connectionId', query.scope.connectionId)
    return `/admin/diagnostics/analysis?${q.toString()}`
  }, [query.period, query.scope])

  const chapterOpen = selection.selection?.kind === 'chapter'
  const beatOpen = selection.selection?.kind === 'beat' || selection.selection?.kind === 'cluster'
  const laneOpen = selection.selection?.kind === 'lane'

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col gap-3">
      <div className="shrink-0">
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
          onZoomIn={() => canvasRef.current?.zoomIn()}
          onZoomOut={() => canvasRef.current?.zoomOut()}
          onFit={() => canvasRef.current?.fit()}
        />
      </div>

      {query.error && (
        <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {query.error}
          <button type="button" className="ml-3 underline" onClick={() => void query.reload()}>
            Retry
          </button>
        </div>
      )}

      <div className="min-h-0 min-w-0 flex-1">
        {query.loading ? (
          <Skeleton className="h-full min-h-[min(60vh,520px)] w-full rounded-xl" />
        ) : (
          <NarrativeCanvas
            ref={canvasRef}
            narrative={query.narrative}
            granularity={query.granularity}
            layers={query.layers}
            highlightChapterKey={selection.highlightChapterKey}
            highlightSpanIds={selection.highlightSpanIds}
            onSelectChapter={selection.selectChapter}
            onHoverChapter={(c) =>
              selection.hoverChapter(c?.key ?? null, c?.spans.map((s) => s.spanId) ?? [])
            }
            onSelectCluster={selection.selectCluster}
            onSelectLane={selection.selectLane}
            onLoadEarlier={() => void query.loadEarlier()}
            hasEarlier={query.hasEarlier}
            loadingEarlier={query.loadingEarlier}
          />
        )}
      </div>

      <ChapterSheet
        chapter={selection.selection?.kind === 'chapter' ? selection.selection.chapter : null}
        open={chapterOpen}
        onOpenChange={(o) => {
          if (!o) selection.clear()
        }}
      />
      <BeatSheet
        beat={selection.selection?.kind === 'beat' ? selection.selection.beat : null}
        cluster={selection.selection?.kind === 'cluster' ? selection.selection.cluster : null}
        open={beatOpen}
        onOpenChange={(o) => {
          if (!o) selection.clear()
        }}
      />
      <SessionPeekSheet
        lane={selection.selection?.kind === 'lane' ? selection.selection.lane : null}
        open={laneOpen}
        onOpenChange={(o) => {
          if (!o) selection.clear()
        }}
      />
    </div>
  )
}
