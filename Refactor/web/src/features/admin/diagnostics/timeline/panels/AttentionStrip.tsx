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

/** Real faults/warnings only — lifecycle closes (SessionTimedOut) are excluded. */
export function AttentionStrip({ chapters, selectedKey, onSelect }: AttentionStripProps) {
  const attention = chapters
    .filter((c) => {
      if (c.outcome === 'failed' || c.outcome === 'warning') return true
      return c.beats.some((b) => isFaultEvent(b.event))
    })
    .sort((a, b) => b.endMs - a.endMs)
    .slice(0, 6)

  if (attention.length === 0) return null

  return (
    <section className="space-y-2" aria-label="Faults needing attention">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-destructive">Faults</h2>
        <span className="text-[11px] text-muted-foreground">{attention.length} in this period</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {attention.map((chapter) => {
          const cause = resolveChapterCause(chapter)
          const active = selectedKey === chapter.key
          return (
            <button
              key={chapter.key}
              type="button"
              onClick={() => onSelect(chapter)}
              className={cn(
                'rounded-lg border px-3 py-2.5 text-left transition-colors',
                chapter.outcome === 'failed'
                  ? 'border-destructive/40 bg-destructive/5 hover:bg-destructive/10'
                  : 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10',
                active && 'ring-2 ring-primary/50',
              )}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                <span className="truncate text-sm font-semibold">
                  {cause?.kind === 'lifecycle' ? chapter.proseHint.slice(0, 80) : (cause?.title ?? 'Fault')}
                </span>
                <Badge variant={chapter.outcome === 'failed' ? 'destructive' : 'warning'} className="ml-auto h-5 capitalize">
                  {chapter.outcome}
                </Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                {cause?.kind === 'lifecycle' ? chapter.proseHint : (cause?.detail ?? chapter.proseHint)}
              </p>
              <p className="mt-1.5 text-[10px] tabular-nums text-muted-foreground/80">
                {formatDuration(chapter.durationMs)} · {chapter.beats.length} beats
                {chapter.connectionId ? ` · ${chapter.connectionId.slice(0, 8)}` : ''}
              </p>
            </button>
          )
        })}
      </div>
    </section>
  )
}
