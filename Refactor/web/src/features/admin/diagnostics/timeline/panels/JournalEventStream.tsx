import { useMemo } from 'react'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { cn } from '@/lib/utils'
import { eventRoleLabel, eventTone, isNaturalLifecycleClose } from '../model/eventSemantics'
import { formatClock, shortEventLabel } from './chapterSheetModel'

interface JournalEventStreamProps {
  events: DiagnosticsEventRecord[]
  selectedId: string | null
  onSelect: (event: DiagnosticsEventRecord) => void
}

type StreamRow =
  | { kind: 'group'; key: string; label: string; count: number }
  | { kind: 'event'; event: DiagnosticsEventRecord }

function groupLabel(event: DiagnosticsEventRecord): { key: string; label: string } {
  if (event.connectionId) {
    const short = event.connectionId.length > 12 ? event.connectionId.slice(0, 12) : event.connectionId
    return { key: `sess:${event.connectionId}`, label: `Session ${short}` }
  }
  if (event.domain === 'Telemetry') return { key: 'telemetry', label: 'Telemetry' }
  if (event.domain === 'Diagnostics') return { key: 'diagnostics', label: 'Diagnostics / system' }
  return { key: `dom:${event.domain}`, label: event.domain || 'System' }
}

function buildRows(events: DiagnosticsEventRecord[]): StreamRow[] {
  const ordered = [...events].sort((a, b) => {
    const sa = a.seq
    const sb = b.seq
    if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb) return sa - sb
    return Date.parse(a.utc) - Date.parse(b.utc) || a.id.localeCompare(b.id)
  })
  const rows: StreamRow[] = []
  let lastKey = ''
  let groupIdx = -1
  for (const event of ordered) {
    const g = groupLabel(event)
    if (g.key !== lastKey) {
      rows.push({ kind: 'group', key: g.key, label: g.label, count: 0 })
      groupIdx = rows.length - 1
      lastKey = g.key
    }
    rows.push({ kind: 'event', event })
    const group = rows[groupIdx]
    if (group?.kind === 'group') group.count += 1
  }
  return rows
}

/**
 * Chronological journal fact stream — dense debug surface.
 * Grouped by session / telemetry / domain.
 */
export function JournalEventStream({ events, selectedId, onSelect }: JournalEventStreamProps) {
  const rows = useMemo(() => buildRows(events), [events])

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No journal facts in this scope and period.
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-card" aria-label="Journal event stream">
      <header className="flex items-baseline justify-between gap-2 border-b border-border/50 px-3 py-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Facts</h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">{events.length}</span>
      </header>
      <ul className="font-mono text-[11px]">
        {rows.map((row) => {
          if (row.kind === 'group') {
            return (
              <li
                key={`g:${row.key}`}
                className="border-y border-border/40 bg-muted/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {row.label}
                <span className="ml-2 font-normal normal-case tracking-normal tabular-nums">{row.count}</span>
              </li>
            )
          }
          const { event } = row
          const tone = eventTone(event)
          const active = selectedId === event.id
          return (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => onSelect(event)}
                className={cn(
                  'grid w-full grid-cols-[52px_72px_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-1 text-left hover:bg-muted/40',
                  active && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
                  tone === 'fault' && !active && 'bg-destructive/5',
                )}
              >
                <span className="tabular-nums text-muted-foreground">
                  {typeof event.seq === 'number' ? `#${event.seq}` : '—'}
                </span>
                <span className="tabular-nums text-muted-foreground">{formatClock(Date.parse(event.utc))}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      tone === 'fault'
                        ? 'bg-destructive'
                        : tone === 'warning'
                          ? 'bg-amber-500'
                          : isNaturalLifecycleClose(event.name)
                            ? 'bg-sky-500'
                            : tone === 'metric'
                              ? 'bg-muted-foreground/40'
                              : 'bg-primary/70',
                    )}
                    aria-hidden
                  />
                  <span className="truncate font-sans text-[12px] font-medium text-foreground">
                    {shortEventLabel(event.name)}
                  </span>
                  <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">
                    {event.name}
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 text-[10px]',
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
    </section>
  )
}
