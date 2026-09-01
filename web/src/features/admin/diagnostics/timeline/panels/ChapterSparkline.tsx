import { useMemo } from 'react'
import type { NarrativeChapter } from '../model/narrativeTypes'
import { chapterDensityBuckets, formatClock } from './chapterSheetModel'
import { cn } from '@/lib/utils'

interface ChapterSparklineProps {
  chapter: NarrativeChapter
  className?: string
  compact?: boolean
}

/** Compact density of beats across the chapter window. */
export function ChapterSparkline({ chapter, className, compact }: ChapterSparklineProps) {
  const buckets = useMemo(() => chapterDensityBuckets(chapter, compact ? 48 : 40), [chapter, compact])
  const max = Math.max(1, ...buckets)

  return (
    <div className={cn('space-y-0.5', className)}>
      <div
        className={cn(
          'flex items-end gap-px rounded-md border border-border/50 bg-muted/15 px-1',
          compact ? 'h-7 py-1' : 'h-11 py-1.5',
        )}
        role="img"
        aria-label={`Beat density across ${chapter.beats.length} beats`}
      >
        {buckets.map((c, i) => (
          <div
            key={i}
            className={cn('min-w-0 flex-1 rounded-sm', c > 0 ? 'bg-sky-400/80' : 'bg-muted-foreground/10')}
            style={{ height: c > 0 ? `${Math.max(compact ? 8 : 14, (c / max) * 100)}%` : '2px' }}
            title={c > 0 ? `${c} beat${c === 1 ? '' : 's'}` : undefined}
          />
        ))}
      </div>
      <div className="flex justify-between px-0.5 text-[9px] tabular-nums text-muted-foreground">
        <span>{formatClock(chapter.startMs)}</span>
        <span>{formatClock(chapter.endMs)}</span>
      </div>
    </div>
  )
}