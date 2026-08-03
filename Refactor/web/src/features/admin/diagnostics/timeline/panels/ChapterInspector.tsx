import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { SeverityBadge } from '@/components/admin/SeverityBadge'
import { describeEvent } from '@/lib/diagnosticsDescriptions'
import { detectStoryType, STORY_TYPES, formatDuration } from '@/lib/diagnosticsConstants'
import type { NarrativeChapter } from '../model/narrativeTypes'
import { resolveChapterCause, salientBeats } from '../model/chapterCause'
import { formatClock, shortEventLabel } from './chapterSheetModel'
import { ArrowRight, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChapterInspectorProps {
  chapter: NarrativeChapter
  onClose: () => void
  onJumpToMs?: (ms: number) => void
}

/**
 * Flat incident brief — one vertical story, failures first, no nested scroll columns.
 */
export function ChapterInspector({ chapter, onClose, onJumpToMs }: ChapterInspectorProps) {
  const typeLabel = STORY_TYPES[detectStoryType(chapter.beats.map((b) => b.event.name))]?.label ?? 'Chapter'
  const cause = useMemo(() => resolveChapterCause(chapter), [chapter])
  const salient = useMemo(() => salientBeats(chapter), [chapter])
  const [showAll, setShowAll] = useState(false)
  const [techOpen, setTechOpen] = useState(false)
  const visible = showAll ? chapter.beats : salient

  return (
    <section id="timeline-brief" className="rounded-xl border border-border bg-card" aria-label="Chapter brief">
      <header className="flex items-start gap-3 border-b border-border/50 px-4 py-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{typeLabel}</h2>
            <Badge
              variant={
                chapter.outcome === 'failed'
                  ? 'destructive'
                  : chapter.outcome === 'warning'
                    ? 'warning'
                    : chapter.outcome === 'ok'
                      ? 'success'
                      : 'muted'
              }
              className="capitalize"
            >
              {chapter.outcome}
            </Badge>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatDuration(chapter.durationMs)} · {chapter.beats.length} beats
            </span>
            {chapter.connectionId && (
              <Link
                to={`/admin/sessions/${encodeURIComponent(chapter.connectionId)}`}
                className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
              >
                Session <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
          {!cause && <p className="text-sm leading-snug text-muted-foreground">{chapter.proseHint}</p>}
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </header>

      {cause && (
        <div
          className={cn(
            'border-b px-4 py-3',
            cause.kind === 'lifecycle'
              ? 'border-sky-500/30 bg-sky-500/5'
              : cause.kind === 'warning'
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-destructive/30 bg-destructive/5',
          )}
        >
          <p className="text-sm font-semibold text-foreground">{cause.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{cause.detail}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">{cause.event.name}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => onJumpToMs?.(Date.parse(cause.event.utc))}
            >
              Jump to cause
            </Button>
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {showAll ? 'All beats' : 'What happened'}
          </p>
          <button
            type="button"
            className="text-[11px] text-primary hover:underline"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? `Show salient (${salient.length})` : `Show all ${chapter.beats.length} beats`}
          </button>
        </div>
        <ol className="space-y-0 border-l border-border/60 pl-4">
          {visible.map((b) => {
            const isCause = cause?.event.id === b.event.id
            return (
              <li key={b.event.id} className="relative pb-3 last:pb-0">
                <span
                  className={cn(
                    'absolute -left-[1.15rem] top-1.5 h-2 w-2 rounded-full',
                    (b.event.severity === 'Error' && !/SessionTimedOut$/i.test(b.event.name)) ||
                    /Failed/.test(b.event.name)
                      ? 'bg-destructive'
                      : /SessionTimedOut$/i.test(b.event.name)
                        ? 'bg-sky-500'
                        : b.event.severity === 'Warning'
                          ? 'bg-amber-500'
                          : 'bg-primary/70',
                  )}
                />
                <button
                  type="button"
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left hover:bg-muted/30',
                    isCause && 'bg-destructive/5 ring-1 ring-destructive/30',
                  )}
                  onClick={() => onJumpToMs?.(b.ms)}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[11px] tabular-nums text-muted-foreground">{formatClock(b.ms)}</span>
                    <span className="text-sm font-medium">{shortEventLabel(b.event.name)}</span>
                    <DomainBadge domain={b.event.domain} showTooltip={false} />
                    <SeverityBadge severity={b.event.severity} />
                  </div>
                  {(isCause || showAll) && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{describeEvent(b.event.name)}</p>
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="border-t border-border/40 px-4 py-2">
        <button
          type="button"
          className="flex w-full items-center justify-between text-[11px] font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={techOpen}
          onClick={() => setTechOpen((v) => !v)}
        >
          Technical details
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', techOpen && 'rotate-180')} />
        </button>
        {techOpen && (
          <dl className="mt-2 grid gap-1.5 text-[11px] sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Chapter</dt>
              <dd className="truncate font-mono">{chapter.key}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Correlation</dt>
              <dd className="truncate font-mono">{chapter.correlationId ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Start</dt>
              <dd className="truncate font-mono">{new Date(chapter.startMs).toISOString()}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">End</dt>
              <dd className="truncate font-mono">{new Date(chapter.endMs).toISOString()}</dd>
            </div>
          </dl>
        )}
      </div>
    </section>
  )
}