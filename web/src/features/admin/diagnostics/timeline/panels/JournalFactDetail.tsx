import { useEffect, useMemo, useState } from 'react'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { describeEvent } from '@/lib/diagnosticsDescriptions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { eventRoleLabel, eventTone } from '../model/eventSemantics'
import { formatClock, shortEventLabel } from './chapterSheetModel'
import { ChevronDown, Copy, X } from 'lucide-react'

interface JournalFactDetailProps {
  event: DiagnosticsEventRecord
  onClose: () => void
  onFilterSession?: () => void
}

function payloadText(payload: unknown): string {
  try {
    return JSON.stringify(payload ?? null, null, 2)
  } catch {
    return String(payload)
  }
}

/** Compact fact inspector — one scroll region, payload on demand. */
export function JournalFactDetail({ event, onClose, onFilterSession }: JournalFactDetailProps) {
  const tone = eventTone(event)
  const isSample = tone === 'metric'
  const [rawOpen, setRawOpen] = useState(!isSample)
  const ms = Date.parse(event.utc)
  const text = useMemo(() => payloadText(event.payload), [event.payload])
  const stopReason = useMemo(() => {
    const p = event.payload as Record<string, unknown> | null
    const reason = p && typeof p.reason === 'string' ? p.reason : null
    if (!reason) return null
    if (!/SessionStopped|SessionStopping|SessionTimedOut/i.test(event.name)) return null
    return reason
  }, [event.payload, event.name])

  useEffect(() => {
    setRawOpen(eventTone(event) !== 'metric')
  }, [event.id]) // eslint-disable-line react-hooks/exhaustive-deps -- reopen payload policy per fact

  return (
    <section
      id="journal-fact"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
      aria-label="Journal fact detail"
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-border/50 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="truncate text-[13px] font-semibold leading-tight">{shortEventLabel(event.name)}</h2>
            <Badge
              variant={tone === 'fault' ? 'destructive' : tone === 'warning' ? 'warning' : 'muted'}
              className="h-4 px-1.5 text-[9px]"
            >
              {eventRoleLabel(event)}
            </Badge>
            {stopReason && (
              <Badge variant="muted" className="h-4 px-1.5 font-mono text-[9px]">
                reason: {stopReason}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={event.name}>
            {event.name}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-6 w-6 shrink-0 p-0" onClick={onClose} aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto p-2.5 text-xs [scrollbar-width:thin]">
        <p className="text-[11px] leading-snug text-muted-foreground">{describeEvent(event.name)}</p>

        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 font-mono text-[10px] leading-tight">
          <dt className="text-muted-foreground">time</dt>
          <dd className="truncate tabular-nums" title={event.utc}>
            {formatClock(ms)}
            <span className="ml-1 text-muted-foreground/70">{event.utc}</span>
          </dd>
          <dt className="text-muted-foreground">seq</dt>
          <dd className="tabular-nums">{typeof event.seq === 'number' ? event.seq : '—'}</dd>
          <dt className="text-muted-foreground">domain</dt>
          <dd>{event.domain}</dd>
          <dt className="text-muted-foreground">severity</dt>
          <dd>{event.severity}</dd>
          <dt className="text-muted-foreground">session</dt>
          <dd className="truncate" title={event.connectionId ?? undefined}>
            {event.connectionId ? (
              onFilterSession ? (
                <button
                  type="button"
                  className="text-left text-primary hover:underline"
                  title="Filter journal to this session"
                  onClick={onFilterSession}
                >
                  {event.connectionId}
                </button>
              ) : (
                event.connectionId
              )
            ) : (
              '—'
            )}
          </dd>
          <dt className="text-muted-foreground">corr</dt>
          <dd className="truncate" title={event.correlationId ?? undefined}>
            {event.correlationId ?? '—'}
          </dd>
          <dt className="text-muted-foreground">id</dt>
          <dd className="truncate" title={event.id}>
            {event.id}
          </dd>
          {(event.spanId || event.spanKey) && (
            <>
              <dt className="text-muted-foreground">span</dt>
              <dd className="truncate">
                {event.spanId ?? '—'}
                {event.spanRole ? ` · ${event.spanRole}` : ''}
                {event.spanKey ? ` · ${event.spanKey}` : ''}
              </dd>
            </>
          )}
        </dl>

        <div className="border-t border-border/40 pt-2">
          <button
            type="button"
            className="mb-1 flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            aria-expanded={rawOpen}
            onClick={() => setRawOpen((v) => !v)}
          >
            Payload
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', rawOpen && 'rotate-180')} />
          </button>
          {rawOpen && (
            <div className="relative">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1 z-10 h-6 gap-1 px-1.5 text-[10px]"
                onClick={() => void navigator.clipboard.writeText(text)}
              >
                <Copy className="h-3 w-3" />
                Copy
              </Button>
              <pre className="overflow-x-hidden overflow-y-auto break-all rounded-md border border-border/50 bg-muted/15 p-2 pr-14 font-mono text-[10px] leading-relaxed text-foreground [scrollbar-width:thin]">
                {text}
              </pre>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
