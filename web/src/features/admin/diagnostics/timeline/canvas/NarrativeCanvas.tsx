import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type {
  BeatCluster,
  Narrative,
  NarrativeChapter,
  NarrativeGranularity,
  NarrativeLane,
  NarrativeLayers,
} from '../model/narrativeTypes'
import { useTimeScale } from './TimeRail'
import { TimeRailInteract } from './TimeRailInteract'
import { SessionLane } from './SessionLane'
import { BeatRibbon } from './BeatRibbon'
import { GovernanceBandLayer } from '../layers/GovernanceBandLayer'
import { SignalOverlayLayer } from '../layers/SignalOverlayLayer'
import {
  fitViewToChapters,
  jumpView,
  panView,
  zoomView,
  type ViewDomain,
} from './viewDomain'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface NarrativeCanvasHandle {
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
  jumpToMs: (ms: number) => void
}

interface NarrativeCanvasProps {
  narrative: Narrative
  granularity: NarrativeGranularity
  layers: NarrativeLayers
  highlightChapterKey: string | null
  highlightSpanIds: Set<string>
  onSelectChapter: (chapter: NarrativeChapter) => void
  onHoverChapter: (chapter: NarrativeChapter | null) => void
  onSelectCluster: (cluster: BeatCluster) => void
  onSelectLane: (lane: NarrativeLane) => void
  onLoadEarlier?: () => void
  hasEarlier?: boolean
  loadingEarlier?: boolean
}

const LANE_LABEL_W = 176

export const NarrativeCanvas = forwardRef<NarrativeCanvasHandle, NarrativeCanvasProps>(
  function NarrativeCanvas(
    {
      narrative,
      granularity,
      layers,
      highlightChapterKey,
      highlightSpanIds,
      onSelectChapter,
      onHoverChapter,
      onSelectCluster,
      onSelectLane,
      onLoadEarlier,
      hasEarlier,
      loadingEarlier,
    },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)
    const [view, setView] = useState<ViewDomain>(() => ({
      fromMs: narrative.startMs,
      toMs: narrative.endMs,
    }))
    const [focusChapterIdx, setFocusChapterIdx] = useState(0)

    useEffect(() => {
      setView(fitViewToChapters(narrative.chapters, narrative.startMs, narrative.endMs))
    }, [narrative.startMs, narrative.endMs, narrative.eventCount]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      const el = rootRef.current
      if (!el) return
      const ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width
        if (w != null && w > 0) setWidth(Math.floor(w))
      })
      ro.observe(el)
      setWidth(Math.floor(el.clientWidth))
      return () => ro.disconnect()
    }, [])

    const railWidth = Math.max(0, width - LANE_LABEL_W)
    const scale = useTimeScale(view.fromMs, view.toMs, railWidth)

    const dataFrom = narrative.startMs
    const dataTo = narrative.endMs

    const applyZoom = useCallback(
      (factor: number, anchorMs?: number) => {
        setView((prev) => zoomView(prev, factor, dataFrom, dataTo, anchorMs))
      },
      [dataFrom, dataTo],
    )

    const applyPan = useCallback(
      (deltaMs: number) => {
        setView((prev) => panView(prev, deltaMs, dataFrom, dataTo))
      },
      [dataFrom, dataTo],
    )

    const fit = useCallback(() => {
      setView(fitViewToChapters(narrative.chapters, dataFrom, dataTo))
    }, [narrative.chapters, dataFrom, dataTo])

    const jumpToMs = useCallback(
      (ms: number) => {
        setView((prev) => jumpView(prev, ms, dataFrom, dataTo))
      },
      [dataFrom, dataTo],
    )

    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => applyZoom(1.4),
        zoomOut: () => applyZoom(1 / 1.4),
        fit,
        jumpToMs,
      }),
      [applyZoom, fit, jumpToMs],
    )

    const flatChapters = narrative.chapters

    useEffect(() => {
      const el = rootRef.current
      if (!el) return
      function onKey(e: KeyboardEvent) {
        const root = rootRef.current
        if (!root) return
        if (document.activeElement !== root && !root.contains(document.activeElement)) return
        const span = view.toMs - view.fromMs
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          applyPan(-span * 0.15)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          applyPan(span * 0.15)
        } else if (e.key === '+' || e.key === '=') {
          e.preventDefault()
          applyZoom(1.4)
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          applyZoom(1 / 1.4)
        } else if (e.key === 'Enter' && flatChapters[focusChapterIdx]) {
          e.preventDefault()
          onSelectChapter(flatChapters[focusChapterIdx])
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          setFocusChapterIdx((i) => Math.min(flatChapters.length - 1, i + 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocusChapterIdx((i) => Math.max(0, i - 1))
        }
      }
      el.addEventListener('keydown', onKey)
      return () => el.removeEventListener('keydown', onKey)
    }, [view, applyPan, applyZoom, flatChapters, focusChapterIdx, onSelectChapter])

    if (narrative.eventCount === 0) {
      return (
        <div className="flex h-full min-h-[min(60vh,520px)] flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <BookOpen className="h-10 w-10 text-muted-foreground/25" />
          <p className="mt-3 text-sm font-medium">No narrative in this period</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Expand the time window, clear Reading options filters, or wait for motor events to arrive.
          </p>
          {hasEarlier && onLoadEarlier && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 text-xs"
              disabled={loadingEarlier}
              onClick={onLoadEarlier}
            >
              {loadingEarlier ? 'Loading…' : 'Load earlier events'}
            </Button>
          )}
        </div>
      )
    }

    const focusedKey = flatChapters[focusChapterIdx]?.key ?? null

    return (
      <div
        ref={rootRef}
        tabIndex={0}
        role="region"
        aria-label="Narrative canvas. Drag or arrow keys pan the time rail, wheel or plus/minus zoom, Enter opens focused chapter."
        className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <div className="sticky top-0 z-20 shrink-0 border-b border-border/50 bg-card/95 backdrop-blur-sm">
          <div className="flex min-w-0">
            <div
              className="shrink-0 border-r border-border/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              style={{ width: LANE_LABEL_W }}
            >
              Lane
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              {railWidth > 0 && (
                <TimeRailInteract
                  startMs={view.fromMs}
                  endMs={view.toMs}
                  width={railWidth}
                  onZoom={applyZoom}
                  onPan={applyPan}
                />
              )}
            </div>
          </div>
        </div>

        <div className="min-w-0 w-full overflow-x-hidden">
          {layers.governanceBands && width > 0 && (
            <GovernanceBandLayer
              events={narrative.chapters.flatMap((c) => c.beats.map((b) => b.event))}
              scale={scale}
              width={width}
              startMs={view.fromMs}
              endMs={view.toMs}
            />
          )}

          {layers.signalOverlay && width > 0 && (
            <SignalOverlayLayer
              startMs={view.fromMs}
              endMs={view.toMs}
              width={width}
              scale={scale}
            />
          )}

          {width > 0 &&
            narrative.lanes.map((lane) => (
              <SessionLane
                key={lane.id}
                lane={lane}
                scale={scale}
                viewStart={view.fromMs}
                viewEnd={view.toMs}
                width={width}
                granularity={granularity}
                highlightChapterKey={highlightChapterKey ?? focusedKey}
                highlightSpanIds={highlightSpanIds}
                onSelectChapter={onSelectChapter}
                onHoverChapter={onHoverChapter}
                onSelectLane={() => onSelectLane(lane)}
                onJumpToMs={jumpToMs}
              />
            ))}

          {layers.beatRibbon && railWidth > 0 && (
            <div className="flex min-w-0 border-t border-border/40">
              <div
                className="shrink-0 border-r border-border/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                style={{ width: LANE_LABEL_W }}
              >
                Beats
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <BeatRibbon
                  clusters={narrative.clusters}
                  scale={scale}
                  width={railWidth}
                  viewStart={view.fromMs}
                  viewEnd={view.toMs}
                  granularity={granularity}
                  onSelectCluster={onSelectCluster}
                />
              </div>
            </div>
          )}

          {hasEarlier && onLoadEarlier && (
            <div className="flex justify-center border-t border-border/30 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-muted-foreground"
                disabled={loadingEarlier}
                onClick={onLoadEarlier}
              >
                {loadingEarlier ? 'Loading earlier…' : 'Load earlier events'}
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  },
)
