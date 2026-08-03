import { ChevronRight } from 'lucide-react'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { cn } from '@/lib/utils'
import { eventRoleLabel, eventTone } from '../model/eventSemantics'
import { formatClock, shortEventLabel } from './chapterSheetModel'
import type { JournalSessionGroup } from './journalStreamModel'
import { formatChapterWhen, formatDurationShort } from './journalStreamModel'

interface JournalSessionGroupRowProps {
  group: JournalSessionGroup
  expanded: boolean
  onToggle: () => void
  selectedId: string | null
  onSelect: (event: DiagnosticsEventRecord) => void
  onFilterSession?: (connectionId: string) => void
}

function toneDot(tone: JournalSessionGroup['tone']) {
  return cn(
    'inline-block h-2 w-2 shrink-0 rounded-full',
    tone === 'fault'
      ? 'bg-destructive'
      : tone === 'warning'
        ? 'bg-amber-500'
        : tone === 'lifecycle'
          ? 'bg-sky-500'
          : tone === 'metric'
            ? 'bg-muted-foreground/40'
            : 'bg-emerald-500/80',
  )
}

/** Expandable session group — one chronological anchor, correlated facts inside. */
export function JournalSessionGroupRow({
  group,
  expanded,
  onToggle,
  selectedId,
  onSelect,
  onFilterSession,
}: JournalSessionGroupRowProps) {
  const factCount = group.listEvents.reduce((n, r) => n + r.runCount, 0)
  const hasSelected = group.events.some((e) => e.id === selectedId)

  return (
    <div
      className={cn(
        'border-b border-border/40',
        hasSelected && !expanded && 'bg-primary/5',
        group.tone === 'fault' && 'bg-destructive/[0.04]',
      )}
    >
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left hover:bg-muted/30"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <ChevronRight
            className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
            aria-hidden
          />
          <span className={cn('mt-1', toneDot(group.tone))} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[12px] font-semibold text-foreground">{group.title}</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {formatChapterWhen(group.anchorMs)}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {formatDurationShort(group.anchorMs, group.endMs)}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
              <span
                className={cn(
                  'truncate font-medium',
                  group.tone === 'fault' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {group.outcome}
              </span>
              <span className="tabular-nums text-muted-foreground/80">
                {factCount} {factCount === 1 ? 'fact' : 'facts'}
              </span>
              {group.faultCount > 0 && (
                <span className="tabular-nums text-destructive">{group.faultCount} fault</span>
              )}
            </div>
          </div>
        </button>
        {onFilterSession && (
          <button
            type="button"
            className="shrink-0 self-center px-2 text-[10px] font-medium text-primary hover:underline"
            title="Show only this session"
            onClick={(e) => {
              e.stopPropagation()
              onFilterSession(group.sessionId)
            }}
          >
            Only this
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border/30 bg-muted/15 pb-1">
          <div className="flex gap-2 px-2 py-1 pl-8 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            <span className="w-2" />
            <span className="w-[4.75rem]">Time</span>
            <span className="min-w-0 flex-1">What happened</span>
            <span className="w-[5.5rem]">Kind</span>
          </div>
          <ul aria-label={`${group.title} facts`}>
            {group.listEvents.map(({ event, runCount }) => {
              const active = selectedId === event.id
              const tone = eventTone(event)
              return (
                <li key={`${event.id}:${event.seq ?? ''}`}>
                  <button
                    type="button"
                    data-event-id={event.id}
                    aria-selected={active}
                    title={event.name}
                    onClick={() => onSelect(event)}
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-border/15 px-2 py-1 pl-8 text-left text-[12px] hover:bg-muted/40',
                      active && 'bg-primary/12 ring-1 ring-inset ring-primary/35',
                      tone === 'fault' && !active && 'bg-destructive/[0.06]',
                    )}
                  >
                    <span className={cn('shrink-0', toneDot(tone))} />
                    <span className="w-[4.75rem] shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatClock(Date.parse(event.utc))}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {shortEventLabel(event.name)}
                      {runCount > 1 ? (
                        <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">×{runCount}</span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        'w-[5.5rem] shrink-0 truncate text-[10px]',
                        tone === 'fault' ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {eventRoleLabel(event)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
