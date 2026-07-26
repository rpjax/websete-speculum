import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { SeverityBadge } from '@/components/admin/SeverityBadge'
import { describeEvent, describeErrorCode } from '@/lib/diagnosticsDescriptions'
import type { BeatCluster, NarrativeBeat } from '../model/narrativeTypes'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BeatSheetProps {
  beat: NarrativeBeat | null
  cluster: BeatCluster | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function BeatStory({ beat }: { beat: NarrativeBeat }) {
  const [tech, setTech] = useState(false)
  const payload = beat.event.payload as Record<string, unknown> | null
  const errorCode = typeof payload?.errorCode === 'string' ? payload.errorCode : null
  const prose = describeEvent(beat.event.name)

  return (
    <div className="space-y-2 border-b border-border/50 pb-4 last:border-0 last:pb-0">
      <p className="text-sm leading-relaxed text-foreground">{prose}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{beat.event.name}</span>
        <DomainBadge domain={beat.event.domain} showTooltip={false} />
        <SeverityBadge severity={beat.event.severity} />
      </div>
      <p className="text-[10px] tabular-nums text-muted-foreground">
        {new Date(beat.event.utc).toLocaleString()}
        {typeof beat.event.seq === 'number' ? ` · #${beat.event.seq}` : ''}
      </p>
      {errorCode && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
          <p className="font-medium">{describeErrorCode(errorCode).summary}</p>
          <p className="mt-1 opacity-80">{describeErrorCode(errorCode).detail}</p>
        </div>
      )}
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        aria-expanded={tech}
        onClick={() => setTech((v) => !v)}
      >
        Technical details
        <ChevronDown className={cn('h-3 w-3 transition-transform', tech && 'rotate-180')} />
      </button>
      {tech && (
        <dl className="space-y-1 rounded-md border border-border/40 bg-muted/10 p-2">
          {beat.event.spanId && (
            <Row label="Span" value={beat.event.spanKey ?? beat.event.spanId} />
          )}
          {beat.event.causationId && <Row label="Causation" value={beat.event.causationId} />}
          {beat.event.correlationId && <Row label="Correlation" value={beat.event.correlationId} />}
          {payload &&
            Object.entries(payload).map(([k, v]) => (
              <Row key={k} label={k} value={formatVal(v)} />
            ))}
        </dl>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-right">{value}</dd>
    </div>
  )
}

function formatVal(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

export function BeatSheet({ beat, cluster, open, onOpenChange }: BeatSheetProps) {
  const beats = cluster?.beats ?? (beat ? [beat] : [])
  const isCluster = Boolean(cluster && cluster.beats.length > 1)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{isCluster ? `${beats.length} beats at once` : 'Beat'}</SheetTitle>
          <SheetDescription className="text-left leading-relaxed">
            {isCluster
              ? 'Several facts landed at nearly the same instant. Read each as a short story beat — technical ids stay collapsed.'
              : 'One narrative fact from the Motor timeline.'}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-4">
          {beats.map((b) => (
            <BeatStory key={b.event.id} beat={b} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
