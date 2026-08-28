import { cn } from '@/lib/utils'
import type { ScaleTime } from 'd3-scale'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { detectStoryType, STORY_TYPES, formatDuration } from '@/lib/diagnosticsConstants'
import type { NarrativeChapter, NarrativeGranularity, NarrativeSpan } from '../model/narrativeTypes'
import { msToX } from './TimeRail'
import { clampBar } from './viewDomain'

const OUTCOME_BADGE: Record<string, 'success' | 'warning' | 'destructive' | 'muted'> = {
  ok: 'success',
  warning: 'warning',
  failed: 'destructive',
  open: 'muted',
  unknown: 'muted',
}

const SPAN_STATUS: Record<NarrativeSpan['status'], string> = {
  open: 'bg-sky-500 animate-pulse',
  closed: 'bg-emerald-500',
  abandoned: 'bg-destructive',
}

/** Vertical pitch for overlap packing (chapter chip + span rail). */
export const CHAPTER_ROW_PITCH = 44
const CHIP_MIN_W = 96
const CHIP_MAX_W = 280

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

  const clampedStart = Math.max(chapter.startMs, viewStart)
  const clampedEnd = Math.min(Math.max(chapter.endMs, chapter.startMs), viewEnd)
  const rawLeft = msToX(scale, clampedStart)
  const rawRight = msToX(scale, clampedEnd)
  const temporal = clampBar(rawLeft, Math.max(rawRight - rawLeft, 4), trackWidth)

  const desiredChip = Math.min(CHIP_MAX_W, Math.max(CHIP_MIN_W, temporal.width))
  const chip = clampBar(rawLeft, desiredChip, trackWidth)
  const top = 6 + row * CHAPTER_ROW_PITCH

  return (
    <div
      className={cn('pointer-events-none absolute inset-x-0', highlighted && 'z-20')}
      style={{ top, height: CHAPTER_ROW_PITCH - 4 }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div
        className={cn(
          'absolute top-[30px] h-1 rounded-full opacity-70',
          chapter.outcome === 'failed' && 'bg-destructive/70',
          chapter.outcome === 'warning' && 'bg-amber-500/70',
          chapter.outcome === 'ok' && 'bg-emerald-500/60',
          (chapter.outcome === 'open' || chapter.outcome === 'unknown') && 'bg-sky-500/60',
        )}
        style={{ left: temporal.left, width: temporal.width }}
        aria-hidden
      />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onSelect}
            className={cn(
              'pointer-events-auto absolute top-0 flex h-8 items-center gap-1.5 overflow-hidden rounded-md border px-2 text-left shadow-sm transition-shadow',
              chapter.outcome === 'failed' && 'border-destructive/45 bg-destructive/15',
              chapter.outcome === 'warning' && 'border-amber-500/45 bg-amber-500/15',
              chapter.outcome === 'ok' && 'border-emerald-500/35 bg-emerald-500/10',
              (chapter.outcome === 'open' || chapter.outcome === 'unknown') && 'border-sky-500/35 bg-sky-500/10',
              highlighted && 'ring-2 ring-primary/55',
            )}
            style={{ left: chip.left, width: chip.width }}
            aria-label={`${label}, ${chapter.outcome}, ${formatDuration(chapter.durationMs)}`}
          >
            <span className="min-w-0 truncate text-[11px] font-semibold text-foreground">{label}</span>
            <Badge
              variant={OUTCOME_BADGE[chapter.outcome] ?? 'muted'}
              className="shrink-0 px-1 py-0 text-[9px] capitalize"
            >
              {chapter.outcome}
            </Badge>
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {formatDuration(chapter.durationMs)}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
          {chapter.proseHint}
        </TooltipContent>
      </Tooltip>

      {granularity !== 'chapters' &&
        chapter.spans.map((span) => {
          if (span.endMs != null && span.endMs < viewStart) return null
          if (span.startMs > viewEnd) return null
          const sLeft = msToX(scale, Math.max(span.startMs, viewStart))
          const sRight = msToX(scale, Math.min(span.endMs ?? chapter.endMs, viewEnd))
          const bar = clampBar(sLeft + span.depth * 3, Math.max(sRight - sLeft, 4), trackWidth)
          if (bar.width <= 0) return null
          const color =
            span.status === 'closed' && !span.ok ? 'bg-amber-500' : SPAN_STATUS[span.status]
          return (
            <div
              key={span.spanId}
              className={cn(
                'absolute top-[34px] h-1 rounded-full',
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
