import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { SeverityBadge } from '@/components/admin/SeverityBadge'
import { describeEvent, describeErrorCode } from '@/lib/diagnosticsDescriptions'
import { detectStoryType, STORY_TYPES, formatDuration } from '@/lib/diagnosticsConstants'
import type { NarrativeChapter } from '../model/narrativeTypes'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChapterSheetProps {
  chapter: NarrativeChapter | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChapterSheet({ chapter, open, onOpenChange }: ChapterSheetProps) {
  const [technicalOpen, setTechnicalOpen] = useState(false)
  const type = chapter ? detectStoryType(chapter.beats.map((b) => b.event.name)) : 'unknown'
  const typeLabel = STORY_TYPES[type]?.label ?? 'Chapter'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        {chapter && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">{typeLabel}</SheetTitle>
              <SheetDescription className="text-left text-sm leading-relaxed text-foreground/90">
                {chapter.proseHint}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex flex-wrap gap-2">
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
              <Badge variant="muted">{formatDuration(chapter.durationMs)}</Badge>
              <Badge variant="muted">{chapter.beats.length} beats</Badge>
              <Badge variant="muted">{chapter.spans.length} spans</Badge>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              This chapter groups correlated motor activity
              {chapter.correlationId ? ` under correlation ${chapter.correlationId.slice(0, 8)}…` : ''}.
              Read the beats below in time order — each line is one narrative fact.
            </p>

            {chapter.connectionId && (
              <Link
                to={`/admin/sessions/${encodeURIComponent(chapter.connectionId)}`}
                className="mt-4 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary hover:bg-primary/10"
              >
                Open session details <ArrowRight className="h-4 w-4" />
              </Link>
            )}

            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Story beats</p>
              <ol className="mt-3 space-y-0 border-l border-border/60 pl-4">
                {chapter.beats.map((b) => {
                  const payload = b.event.payload as Record<string, unknown> | null
                  const errorCode = typeof payload?.errorCode === 'string' ? payload.errorCode : null
                  return (
                    <li key={b.event.id} className="relative pb-4 last:pb-0">
                      <span className="absolute -left-[1.15rem] top-1.5 h-2 w-2 rounded-full bg-primary/70" />
                      <p className="text-sm font-medium text-foreground">{describeEvent(b.event.name)}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        <span className="font-mono">{b.event.name}</span>
                        {' · '}
                        {new Date(b.event.utc).toLocaleString()}
                        {typeof b.event.seq === 'number' ? ` · #${b.event.seq}` : ''}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <DomainBadge domain={b.event.domain} showTooltip={false} />
                        <SeverityBadge severity={b.event.severity} />
                      </div>
                      {errorCode && (
                        <p className="mt-2 text-xs text-destructive">{describeErrorCode(errorCode).summary}</p>
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>

            <div className="mt-6 border-t border-border pt-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
                aria-expanded={technicalOpen}
                onClick={() => setTechnicalOpen((v) => !v)}
              >
                Technical details
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', technicalOpen && 'rotate-180')} />
              </button>
              {technicalOpen && (
                <dl className="mt-3 space-y-2 text-xs">
                  <Row label="Chapter key" value={chapter.key} mono />
                  <Row label="Correlation" value={chapter.correlationId ?? '—'} mono />
                  <Row label="Connection" value={chapter.connectionId ?? '—'} mono />
                  <Row label="Start" value={new Date(chapter.startMs).toISOString()} mono />
                  <Row label="End" value={new Date(chapter.endMs).toISOString()} mono />
                  <Row
                    label="Span ids"
                    value={chapter.spans.map((s) => s.spanId.slice(0, 8)).join(', ') || '—'}
                    mono
                  />
                </dl>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('truncate text-right', mono && 'font-mono')}>{value}</dd>
    </div>
  )
}
