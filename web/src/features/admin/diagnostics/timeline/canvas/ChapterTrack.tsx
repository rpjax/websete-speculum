import { cn } from '@/lib/utils'
import type { ScaleTime } from 'd3-scale'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { detectStoryType, STORY_TYPES, formatDuration } from '@/lib/diagnosticsConstants'
import type { NarrativeChapter, NarrativeGranularity, NarrativeSpan } from '../model/narrativeTypes'
import { msToX } from './TimeRail'
import { clampBar } from './viewDomain'

const SPAN_STATUS: Record<NarrativeSpan['status'], string> = {
  open: 'bg-sky-400 animate-pulse',
  closed: 'bg-emerald-400',
  abandoned: 'bg-destructive',
}

/** Vertical pitch for overlap packing (full temporal bar + optional span hairs). */
export const CHAPTER_ROW_PITCH = 42
/** Below this width the label collapses to a marker + tooltip. */
const LABEL_MIN_W = 88

interface ChapterTrackProps {
  chapter: NarrativeChapter
  scale: ScaleTime<number, number>
  viewStart: number
  viewEnd: number
  trackWidth: number
  row: number
  granularity: NarrativeGranularity
  highlighted: boolean
  highlightSpanIds: Set<string>
  onSelect: () => void
  onHover: (on: boolean) => void
}

const OUTCOME_BAR: Record<string, string> = {
  failed: 'border-destructive/60 bg-destructive/30 hover:bg-destructive/40',
  warning: 'border-amber-500/55 bg-amber-500/25 hover:bg-amber-500/35',
  ok: 'border-emerald-500/50 bg-emerald-500/20 hover:bg-emerald-500/30',
  open: 'border-sky-500/50 bg-sky-500/20 hover:bg-sky-500/30',
  unknown: 'border-border bg-muted/50 hover:bg-muted/65',
}

const OUTCOME_DOT: Record<string, string> = {
  failed: 'bg-destructive',
  warning: 'bg-amber-500',
  ok: 'bg-emerald-500',
  open: 'bg-sky-500',
  unknown: 'bg-muted-foreground',
}

/**
 * Temporal bar is the primary visual (true duration). Label rides inside when
 * there is room; otherwise a compact marker + tooltip preserves readability.
 */
export function ChapterTrack({
  chapter,
  scale,
  viewStart,
  viewEnd,
  trackWidth,
  row,
  granularity,
  highlighted,
  highlightSpanIds,
  onSelect,
  onHover,
}: ChapterTrackProps) {
  const type = detectStoryType(chapter.beats.map((b) => b.event.name))
  const label = STORY_TYPES[type]?.label ?? 'Chapter'

  const outcome = chapter.outcome
  const clampedStart = Math.max(chapter.startMs, viewStart)
  const clampedEnd = Math.min(Math.max(chapter.endMs, chapter.startMs), viewEnd)
  const rawLeft = msToX(scale, clampedStart)
  const rawRight = msToX(scale, clampedEnd)
  // Short chapters (e.g. 57s in a 1h window) must stay clickable — floor by outcome urgency.
  const minBar = outcome === 'failed' || outcome === 'warning' ? 18 : 10
  const temporal = clampBar(rawLeft, Math.max(rawRight - rawLeft, minBar), trackWidth)
  const top = 6 + row * CHAPTER_ROW_PITCH
  const showLabel = temporal.width >= LABEL_MIN_W
  const duration = formatDuration(chapter.durationMs)

  return (
    <div
      className={cn('pointer-events-none absolute inset-x-0', highlighted && 'z-20')}
      style={{ top, height: CHAPTER_ROW_PITCH - 4 }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onSelect}
            className={cn(
              'pointer-events-auto absolute top-1 flex h-8 items-center overflow-hidden rounded-md border text-left shadow-sm transition-colors',
              OUTCOME_BAR[outcome] ?? OUTCOME_BAR.unknown,
              highlighted && 'ring-2 ring-primary/60',
            )}
            style={{ left: temporal.left, width: temporal.width }}
            aria-label={`${label}, ${outcome}, ${duration}`}
          >
            {showLabel ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
                <span
                  className={cn('h-2 w-2 shrink-0 rounded-full', OUTCOME_DOT[outcome] ?? OUTCOME_DOT.unknown)}
                  aria-hidden
                />
                <span className="min-w-0 truncate text-[12px] font-semibold text-foreground">{label}</span>
                <span className="shrink-0 rounded bg-background/50 px-1.5 py-px text-[10px] capitalize text-muted-foreground">
                  {outcome}
                </span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{duration}</span>
              </span>
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <span
                  className={cn('h-2 w-2 rounded-full', OUTCOME_DOT[outcome] ?? OUTCOME_DOT.unknown)}
                  aria-hidden
                />
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
          <p className="font-medium text-foreground">
            {label} · {outcome} · {duration}
          </p>
          <p className="mt-1 text-muted-foreground">{chapter.proseHint}</p>
        </TooltipContent>
      </Tooltip>

      {granularity !== 'chapters' &&
        chapter.spans.map((span) => {
          if (span.endMs != null && span.endMs < viewStart) return null
          if (span.startMs > viewEnd) return null
          const sLeft = msToX(scale, Math.max(span.startMs, viewStart))
          const sRight = msToX(scale, Math.min(span.endMs ?? chapter.endMs, viewEnd))
          const bar = clampBar(sLeft + span.depth * 2, Math.max(sRight - sLeft, 3), trackWidth)
          if (bar.width <= 0) return null
          const color =
            span.status === 'closed' && !span.ok ? 'bg-amber-500' : SPAN_STATUS[span.status]
          return (
            <div
              key={span.spanId}
              className={cn(
                'absolute top-[32px] h-0.5 rounded-full',
                color,
                highlightSpanIds.has(span.spanId) && 'ring-1 ring-primary',
              )}
              style={{ left: bar.left, width: bar.width }}
              title={`${span.spanKey ?? span.open.name} · ${span.status}`}
            />
          )
        })}
    </div>
  )
}

/** Greedy overlap packing: chapters that overlap in time get distinct rows. */
export function packChapterRows(chapters: NarrativeChapter[]): Map<string, number> {
  const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const rowEnds: number[] = []
  const rows = new Map<string, number>()
  for (const c of sorted) {
    const end = Math.max(c.endMs, c.startMs)
    let row = 0
    while (row < rowEnds.length && rowEnds[row] > c.startMs) row++
    rowEnds[row] = end
    rows.set(c.key, row)
  }
  return rows
}
