import { Badge } from '@/components/ui/badge'
import { formatDuration } from '@/lib/diagnosticsConstants'
import type { NarrativeChapter } from '../model/narrativeTypes'
import { resolveChapterCause } from '../model/chapterCause'
import { isFaultEvent } from '../model/eventSemantics'
import { cn } from '@/lib/utils'
import { AlertTriangle } from 'lucide-react'

interface AttentionStripProps {
  chapters: NarrativeChapter[]
  selectedKey: string | null
  onSelect: (chapter: NarrativeChapter) => void
}

/** Compact fault jump-list — one row, does not steal the journal viewport. */
export function AttentionStrip({ chapters, selectedKey, onSelect }: AttentionStripProps) {
  const attention = chapters
    .filter((c) => {
      if (c.outcome === 'failed' || c.outcome === 'warning') return true
      return c.beats.some((b) => isFaultEvent(b.event))
    })
    .sort((a, b) => b.endMs - a.endMs)
    .slice(0, 8)

  if (attention.length === 0) return null

  return (
    <section
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:thin]"
      aria-label="Faults needing attention"
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-destructive">
        Faults
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{attention.length}</span>
      {attention.map((chapter) => {
        const cause = resolveChapterCause(chapter)
        const active = selectedKey === chapter.key
        const title = cause?.kind === 'lifecycle' ? chapter.proseHint : (cause?.title ?? 'Fault')
        return (
          <button
            key={chapter.key}
            type="button"
            onClick={() => onSelect(chapter)}
            title={cause?.detail ?? chapter.proseHint}
            className={cn(
              'inline-flex h-7 max-w-[14rem] shrink-0 items-center gap-1.5 rounded-md border px-2 text-left text-[11px] transition-colors',
              chapter.outcome === 'failed'
                ? 'border-destructive/40 bg-destructive/5 hover:bg-destructive/10'
                : 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10',
              active && 'ring-2 ring-primary/50',
            )}
          >
            <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" aria-hidden />
            <span className="truncate font-medium">{title}</span>
            <Badge
              variant={chapter.outcome === 'failed' ? 'destructive' : 'warning'}
              className="ml-auto h-4 shrink-0 px-1 text-[9px] capitalize"
            >
              {chapter.outcome}
            </Badge>
            <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
              {formatDuration(chapter.durationMs)}
            </span>
          </button>
        )
      })}
    </section>
  )
}
