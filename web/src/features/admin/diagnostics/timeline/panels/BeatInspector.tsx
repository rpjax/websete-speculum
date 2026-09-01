import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { describeEvent } from '@/lib/diagnosticsDescriptions'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { SeverityBadge } from '@/components/admin/SeverityBadge'
import { Button } from '@/components/ui/button'
import type { BeatCluster, NarrativeBeat, NarrativeLane } from '../model/narrativeTypes'
import { formatClock, shortEventLabel } from './chapterSheetModel'
import { X } from 'lucide-react'

interface BeatInspectorProps {
  beat?: NarrativeBeat | null
  cluster?: BeatCluster | null
  onClose: () => void
}

export function BeatInspector({ beat, cluster, onClose }: BeatInspectorProps) {
  const beats = cluster?.beats ?? (beat ? [beat] : [])
  const title =
    cluster && cluster.beats.length > 1
      ? `${cluster.beats.length} beats at once`
      : shortEventLabel(beats[0]?.event.name ?? 'Beat')

  return (
    <div>
      <header className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {cluster && cluster.beats.length > 1
              ? 'Several facts landed at nearly the same instant.'
              : 'One Journal fact on the rail.'}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </header>
      <ul className="space-y-3 p-4">
        {beats.map((b) => (
          <li key={b.event.id} className="rounded-md border border-border/40 bg-muted/10 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{shortEventLabel(b.event.name)}</span>
              <DomainBadge domain={b.event.domain} showTooltip={false} />
              <SeverityBadge severity={b.event.severity} />
              <span className="text-[11px] tabular-nums text-muted-foreground">{formatClock(b.ms)}</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{describeEvent(b.event.name)}</p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
              {b.event.name}
              {typeof b.event.seq === 'number' ? ` · #${b.event.seq}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface LaneInspectorProps {
  lane: NarrativeLane
  onClose: () => void
}

export function LaneInspector({ lane, onClose }: LaneInspectorProps) {
  const chapterSummary = useMemo(
    () =>
      lane.chapters
        .slice()
        .sort((a, b) => b.startMs - a.startMs)
        .slice(0, 8),
    [lane.chapters],
  )

  return (
    <div>
      <header className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">{lane.label}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {lane.chapters.length} chapters · {lane.beats.length} beats on this lane
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </header>
      <div className="space-y-2 p-4">
        {lane.kind === 'session' && (
          <Link
            to={`/admin/sessions/${encodeURIComponent(lane.id)}`}
            className="inline-flex text-xs text-primary hover:underline"
          >
            Open session details
          </Link>
        )}
        <ul className="space-y-2">
          {chapterSummary.map((c) => (
            <li
              key={c.key}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border/40 px-3 py-2 text-sm"
            >
              <span className="font-medium capitalize">{c.outcome}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatClock(c.startMs)} · {c.beats.length} beats
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}