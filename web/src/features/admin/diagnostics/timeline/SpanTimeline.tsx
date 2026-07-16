import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, GitBranch, Clock, AlertTriangle, Activity } from 'lucide-react'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { describeEvent } from '@/lib/diagnosticsDescriptions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { buildStories, type Span, type Story } from './spanCompute'

/**
 * Per-story "story-lane" view: each correlated operation (or session) becomes a lane whose spans
 * are laid out on a shared, relative time axis and whose beats read top-to-bottom in `seq` order.
 * Reconstructs open/close spans + causation nesting from the schema-v2 envelope fields.
 */
export function SpanTimeline({ events }: { events: DiagnosticsEventRecord[] }) {
  const stories = useMemo(() => buildStories(events), [events])

  if (stories.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <GitBranch className="h-10 w-10 text-muted-foreground/20" />
        <p className="mt-3 text-sm text-muted-foreground">No stories to reconstruct</p>
        <p className="mt-1 text-xs text-muted-foreground/60">Spans appear once correlated events arrive</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border/10">
      {stories.map((story) => (
        <StoryLane key={story.key} story={story} />
      ))}
    </div>
  )
}

const STATUS_BAR: Record<Span['status'], string> = {
  open: 'bg-sky-500 animate-pulse',
  closed: 'bg-emerald-500',
  abandoned: 'bg-destructive',
}

function spanColor(span: Span): string {
  if (span.status === 'closed' && !span.ok) return 'bg-amber-500'
  return STATUS_BAR[span.status]
}

function StoryLane({ story }: { story: Story }) {
  const [expanded, setExpanded] = useState(false)
  const label = story.correlationId ?? story.connectionId ?? 'System'
  const shortLabel = label.length > 22 ? `${label.slice(0, 22)}…` : label

  return (
    <div className="px-4 py-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <GitBranch className="h-3.5 w-3.5 text-primary/70" />
        <span className="font-mono text-xs text-foreground">{shortLabel}</span>
        <Badge variant="muted" className="px-1 py-0 text-[9px] tabular-nums">
          {story.events.length} beat{story.events.length !== 1 ? 's' : ''}
        </Badge>
        {story.spans.length > 0 && (
          <Badge variant="muted" className="px-1 py-0 text-[9px] tabular-nums">
            {story.spans.length} span{story.spans.length !== 1 ? 's' : ''}
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
          {story.errorCount > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertTriangle className="h-3 w-3" />
              <span className="tabular-nums">{story.errorCount}</span>
            </span>
          )}
          <span className="flex items-center gap-1 tabular-nums">
            <Clock className="h-3 w-3" />
            {formatDuration(story.durationMs)}
          </span>
          <span className="tabular-nums">{new Date(story.startMs).toLocaleTimeString()}</span>
        </span>
      </button>

      {/* Span track — relative time axis for this story. */}
      {story.spans.length > 0 && (
        <div className="mt-2 space-y-1 pl-6">
          {story.spans.map((span) => (
            <SpanBar key={span.spanId} span={span} story={story} />
          ))}
        </div>
      )}

      {/* Ordered beat list (revealed on expand). */}
      {expanded && (
        <div className="mt-2 space-y-0.5 rounded-md border border-border/40 bg-muted/10 p-2 pl-6">
          {story.events.map((evt) => (
            <BeatRow key={evt.id} evt={evt} />
          ))}
        </div>
      )}
    </div>
  )
}

function SpanBar({ span, story }: { span: Span; story: Story }) {
  const range = Math.max(1, story.durationMs)
  const left = ((span.startMs - story.startMs) / range) * 100
  const rawWidth = ((span.endMs ?? story.endMs) - span.startMs) / range * 100
  const width = Math.max(rawWidth, 1.5)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2" style={{ paddingLeft: `${span.depth * 12}px` }}>
          <span className="w-28 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
            {span.spanKey ?? span.open.name}
          </span>
          <div className="relative h-2 flex-1 rounded-full bg-muted/20">
            <div
              className={cn('absolute h-full rounded-full', spanColor(span))}
              style={{ left: `${Math.min(left, 98)}%`, width: `${Math.min(width, 100 - Math.min(left, 98))}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
            {span.durationMs === null ? '—' : formatDuration(span.durationMs)}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs text-xs">
        <p className="font-bold">{span.spanKey ?? span.open.name}</p>
        <p className="mt-1 text-muted-foreground">
          {span.status === 'open' && 'Still open'}
          {span.status === 'closed' && (span.ok ? 'Closed cleanly' : 'Closed with warning/error')}
          {span.status === 'abandoned' && 'Abandoned (timeout / teardown / recovery)'}
        </p>
        <p className="mt-1 text-muted-foreground">
          {span.open.name}{span.close ? ` → ${span.close.name}` : ''}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

function BeatRow({ evt }: { evt: DiagnosticsEventRecord }) {
  const dot = evt.severity === 'Error'
    ? 'bg-destructive'
    : evt.severity === 'Warning'
      ? 'bg-warning'
      : evt.severity === 'Metric'
        ? 'bg-muted-foreground'
        : 'bg-sky-500'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors hover:bg-muted/30">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
          {typeof evt.seq === 'number' && (
            <span className="w-10 shrink-0 text-right text-[9px] tabular-nums text-muted-foreground/50">#{evt.seq}</span>
          )}
          <span className="w-16 shrink-0 tabular-nums text-muted-foreground/60">
            {new Date(evt.utc).toLocaleTimeString()}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{evt.name.split('.').pop()}</span>
          {evt.spanId && <Activity className="h-3 w-3 shrink-0 text-primary/60" />}
          <DomainBadge domain={evt.domain} showTooltip={false} />
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs text-xs">
        <p className="font-bold">{evt.name}</p>
        <p className="mt-1 text-muted-foreground">{describeEvent(evt.name)}</p>
        {evt.spanId && (
          <p className="mt-1 font-mono text-[10px] text-primary/70">
            span {evt.spanKey ?? evt.spanId.slice(0, 8)}
            {evt.causationId ? ` · caused by ${evt.causationId.slice(0, 8)}` : ''}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}
