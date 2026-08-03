import { useMemo, useState } from 'react'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { describeEvent } from '@/lib/diagnosticsDescriptions'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { SeverityBadge } from '@/components/admin/SeverityBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { eventRoleLabel, eventTone } from '../model/eventSemantics'
import { formatClock, shortEventLabel } from './chapterSheetModel'
import { ChevronDown, Copy, X } from 'lucide-react'

interface JournalFactDetailProps {
  event: DiagnosticsEventRecord
  onClose: () => void
  onJumpToMs?: (ms: number) => void
}

function payloadText(payload: unknown): string {
  try {
    return JSON.stringify(payload ?? null, null, 2)
  } catch {
    return String(payload)
  }
}

/** Full diagnostic fact inspector — payload, ids, catalog semantics. */
export function JournalFactDetail({ event, onClose, onJumpToMs }: JournalFactDetailProps) {
  const [rawOpen, setRawOpen] = useState(true)
  const ms = Date.parse(event.utc)
  const tone = eventTone(event)
  const role = eventRoleLabel(event)
  const text = useMemo(() => payloadText(event.payload), [event.payload])

  return (
    <section
      id="journal-fact"
      className="flex min-h-0 flex-col rounded-xl border border-border bg-card"
      aria-label="Journal fact detail"
    >
      <header className="flex items-start gap-2 border-b border-border/50 px-3 py-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="truncate text-sm font-semibold">{shortEventLabel(event.name)}</h2>
            <Badge
              variant={
                tone === 'fault' ? 'destructive' : tone === 'warning' ? 'warning' : 'muted'
              }
              className="h-5 text-[10px]"
            >
              {role}
            </Badge>
            <DomainBadge domain={event.domain} showTooltip={false} />
            <SeverityBadge severity={event.severity} />
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">{event.name}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" onClick={onClose} aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <div className="space-y-3 overflow-visible p-3 text-xs">
        <p className="leading-relaxed text-muted-foreground">{describeEvent(event.name)}</p>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-[11px]">
          <dt className="text-muted-foreground">utc</dt>
          <dd className="truncate">{event.utc}</dd>
          <dt className="text-muted-foreground">clock</dt>
          <dd>
            <button type="button" className="text-primary hover:underline" onClick={() => onJumpToMs?.(ms)}>
              {formatClock(ms)}
            </button>
          </dd>
          <dt className="text-muted-foreground">seq</dt>
          <dd>{typeof event.seq === 'number' ? `#${event.seq}` : '—'}</dd>
          <dt className="text-muted-foreground">id</dt>
          <dd className="truncate">{event.id}</dd>
          <dt className="text-muted-foreground">session</dt>
          <dd className="truncate">{event.connectionId ?? '—'}</dd>
          <dt className="text-muted-foreground">correlation</dt>
          <dd className="truncate">{event.correlationId ?? '—'}</dd>
          <dt className="text-muted-foreground">span</dt>
          <dd className="truncate">
            {event.spanId ?? '—'}
            {event.spanRole ? ` · ${event.spanRole}` : ''}
            {event.spanKey ? ` · ${event.spanKey}` : ''}
          </dd>
          <dt className="text-muted-foreground">redaction</dt>
          <dd>{event.redaction}</dd>
        </dl>

        <div>
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
                className="absolute right-1 top-1 h-6 gap-1 px-1.5 text-[10px]"
                onClick={() => void navigator.clipboard.writeText(text)}
              >
                <Copy className="h-3 w-3" />
                Copy
              </Button>
              <pre className="max-h-[min(50vh,420px)] overflow-auto rounded-md border border-border/50 bg-muted/20 p-2 pr-16 font-mono text-[10px] leading-relaxed text-foreground">
                {text}
              </pre>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
