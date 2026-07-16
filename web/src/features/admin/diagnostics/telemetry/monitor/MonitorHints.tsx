import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import {
  detectAnomalies,
  type ResourceSample,
  type AnomalyKind,
} from '@/lib/resourceChartCompute'
import { TrendingUp, Gauge, Activity, ShieldCheck, ArrowRight } from 'lucide-react'

const KIND_STYLE: Record<AnomalyKind, { icon: React.ReactNode; tone: string; ring: string }> = {
  leak: { icon: <TrendingUp className="h-3.5 w-3.5" />, tone: 'text-red-400', ring: 'border-red-500/30 bg-red-500/5' },
  regression: { icon: <Gauge className="h-3.5 w-3.5" />, tone: 'text-amber-400', ring: 'border-amber-500/30 bg-amber-500/5' },
  efficiency: { icon: <Activity className="h-3.5 w-3.5" />, tone: 'text-emerald-400', ring: 'border-emerald-500/30 bg-emerald-500/5' },
}

/**
 * Lightweight Monitor hints — point-jump only. Not the Analysis report.
 */
export function MonitorHints({
  samples,
  onJump,
}: {
  samples: ResourceSample[]
  onJump?: (timestamp: number) => void
}) {
  const anomalies = useMemo(() => detectAnomalies(samples), [samples])

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/30 px-3 py-1.5 bg-muted/5">
        <Activity className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Hints</span>
        <span className="text-[11px] text-muted-foreground/50">quick point jumps — use Analysis for a full report</span>
        <span className="ml-auto text-[11px] text-muted-foreground/50 tabular-nums">{anomalies.length} found</span>
      </div>

      {anomalies.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-400/70 shrink-0" />
          Resource usage tracks live sessions linearly across this range — no leaks, regressions, or idle scaling detected.
        </div>
      ) : (
        <div className="divide-y divide-border/10">
          {anomalies.map((a, i) => {
            const style = KIND_STYLE[a.kind]
            return (
              <button
                key={i}
                onClick={() => onJump?.(samples[a.peakIndex]?.timestamp ?? 0)}
                className={cn(
                  'group flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/10',
                )}
              >
                <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border', style.ring, style.tone)}>
                  {style.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-semibold', style.tone)}>{a.label}</span>
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                      {new Date(a.startUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {' – '}
                      {new Date(a.endUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{a.description}</p>
                </div>
                {onJump && (
                  <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground/60" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
