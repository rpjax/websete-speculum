import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDuration } from '@/lib/diagnosticsConstants'

interface UptimeBarProps {
  uptimeMs: number
  maxMs?: number
  className?: string
}

export function UptimeBar({ uptimeMs, maxMs = 3600_000, className }: UptimeBarProps) {
  const pct = Math.min((uptimeMs / maxMs) * 100, 100)
  const color = pct > 80 ? 'bg-success' : pct > 40 ? 'bg-primary' : 'bg-warning'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('flex items-center gap-2', className)}>
          <div className="h-1.5 flex-1 rounded-full bg-muted/40">
            <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
          <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
            {formatDuration(uptimeMs)}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        Uptime: {formatDuration(uptimeMs)} ({Math.round(pct)}% of {formatDuration(maxMs)})
      </TooltipContent>
    </Tooltip>
  )
}

interface FpsIndicatorProps {
  fps: number
  className?: string
}

export function FpsIndicator({ fps, className }: FpsIndicatorProps) {
  const color = fps >= 25 ? 'text-success' : fps >= 15 ? 'text-warning' : 'text-destructive'
  const bars = Math.min(Math.ceil(fps / 6), 5)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('flex items-center gap-1', className)}>
          <div className="flex items-end gap-px">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'w-[3px] rounded-t-sm transition-all',
                  i < bars ? color.replace('text-', 'bg-') : 'bg-muted/40',
                )}
                style={{ height: 4 + i * 3 }}
              />
            ))}
          </div>
          <span className={cn('text-xs font-bold tabular-nums', color)}>{fps}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        {fps >= 25 ? 'Excellent frame rate — smooth streaming'
          : fps >= 15 ? 'Acceptable frame rate — may feel slightly laggy'
          : 'Low frame rate — user experience is degraded'}
        <p className="text-muted-foreground">Target: 30 FPS</p>
      </TooltipContent>
    </Tooltip>
  )
}
