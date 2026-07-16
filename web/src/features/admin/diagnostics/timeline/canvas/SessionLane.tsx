import type { ScaleTime } from 'd3-scale'
import type { NarrativeChapter, NarrativeGranularity, NarrativeLane } from '../model/narrativeTypes'
import { CHAPTER_ROW_PITCH, ChapterTrack, packChapterRows } from './ChapterTrack'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface SessionLaneProps {
  lane: NarrativeLane
  scale: ScaleTime<number, number>
  viewStart: number
  viewEnd: number
  width: number
  granularity: NarrativeGranularity
  highlightChapterKey: string | null
  highlightSpanIds: Set<string>
  onSelectChapter: (chapter: NarrativeChapter) => void
  onHoverChapter: (chapter: NarrativeChapter | null) => void
  onSelectLane: () => void
  onJumpToMs: (ms: number) => void
}

export function SessionLane({
  lane,
  scale,
  viewStart,
  viewEnd,
  width,
  granularity,
  highlightChapterKey,
  highlightSpanIds,
  onSelectChapter,
  onHoverChapter,
  onSelectLane,
  onJumpToMs,
}: SessionLaneProps) {
  const trackWidth = Math.max(0, width - 176)
  const visible = lane.chapters.filter((c) => c.endMs >= viewStart && c.startMs <= viewEnd)
  const earlier = lane.chapters.filter((c) => c.endMs < viewStart).sort((a, b) => b.endMs - a.endMs)
  const later = lane.chapters.filter((c) => c.startMs > viewEnd).sort((a, b) => a.startMs - b.startMs)
  const rows = packChapterRows(visible)
  const rowCount = visible.length === 0 ? 1 : Math.max(1, ...[...rows.values()].map((r) => r + 1))
  const trackHeight = Math.max(52, 8 + rowCount * CHAPTER_ROW_PITCH)

  const beatLabel = lane.beats.length === 1 ? '1 beat' : `${lane.beats.length} beats`
  const chapterLabel =
    lane.chapters.length === 1 ? '1 chapter' : `${lane.chapters.length} chapters`

  return (
    <div className="border-b border-border/30">
      <div className="flex min-w-0" style={{ minHeight: trackHeight }}>
        <button
          type="button"
          onClick={onSelectLane}
          className={cn(
            'z-10 flex w-44 shrink-0 items-start border-r border-border/40 bg-card px-3 py-2.5 text-left',
            lane.kind === 'system' ? 'text-amber-400' : 'text-foreground',
          )}
        >
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{lane.label}</p>
            <p className="text-[10px] text-muted-foreground">
              {chapterLabel} · {beatLabel}
            </p>
          </div>
        </button>

        <div
          className="relative min-w-0 flex-1 overflow-hidden"
          style={{ minHeight: trackHeight }}
        >
          {visible.map((chapter) => (
            <ChapterTrack
              key={chapter.key}
              chapter={chapter}
              scale={scale}
              viewStart={viewStart}
              viewEnd={viewEnd}
              trackWidth={trackWidth}
              row={rows.get(chapter.key) ?? 0}
              granularity={granularity}
              highlighted={highlightChapterKey === chapter.key}
              highlightSpanIds={highlightSpanIds}
              onSelect={() => onSelectChapter(chapter)}
              onHover={(on) => onHoverChapter(on ? chapter : null)}
            />
          ))}

          {visible.length === 0 && (
            <div className="absolute inset-0 flex items-center gap-2 px-3">
              {earlier.length > 0 ? (
                <OutsideChip
                  label={
                    earlier.length === 1
                      ? '1 chapter earlier — outside view'
                      : `${earlier.length} chapters earlier — outside view`
                  }
                  onJump={() => onJumpToMs(earlier[0].startMs)}
                />
              ) : later.length > 0 ? (
                <OutsideChip
                  label={
                    later.length === 1
                      ? '1 chapter later — outside view'
                      : `${later.length} chapters later — outside view`
                  }
                  onJump={() => onJumpToMs(later[0].startMs)}
                />
              ) : (
                <span className="text-[11px] text-muted-foreground/80">
                  No chapters in this lane for the loaded window.
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OutsideChip({ label, onJump }: { label: string; onJump: () => void }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-dashed border-border bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={onJump}>
        Jump
      </Button>
    </div>
  )
}

export { SessionLane as SystemLane }
