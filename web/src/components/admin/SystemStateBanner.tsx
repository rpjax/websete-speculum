import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/diagnosticsConstants'
import { ShieldCheck, ShieldAlert, Clock, Zap } from 'lucide-react'

interface SystemStateBannerProps {
  degraded: boolean
  elevate: { active?: boolean; browserQueryFloor?: string; expiresUtc?: string } | null
  onRecover?: () => void
  onClearElevate?: () => void
  recovering?: boolean
}

export function SystemStateBanner({ degraded, elevate, onRecover, onClearElevate, recovering }: SystemStateBannerProps) {
  if (degraded) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-destructive/30 bg-gradient-to-r from-destructive/15 via-destructive/10 to-destructive/5 px-5 py-4">
        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-destructive/5" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/20">
              <ShieldAlert className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-destructive">Degraded</h3>
                <span className="inline-flex items-center rounded-full bg-destructive/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
                  Action required
                </span>
              </div>
              <p className="mt-1 text-sm text-destructive/80 leading-relaxed">
                The diagnostics circuit breaker has tripped. All effective levels are capped at <strong>Metrics</strong>. 
                Event recording and browser probes are unavailable until recovery.
              </p>
              <p className="mt-1.5 text-xs text-destructive/60">
                Probes will return <code className="rounded bg-destructive/10 px-1 py-0.5">probe_level_insufficient</code>
              </p>
            </div>
          </div>
          {onRecover && (
            <Button variant="destructive" size="sm" onClick={onRecover} disabled={recovering} className="shrink-0">
              {recovering ? 'Recovering…' : 'Recover now'}
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (elevate?.active && elevate.expiresUtc) {
    const expiresMs = new Date(elevate.expiresUtc).getTime() - Date.now()
    const expiresLabel = expiresMs > 0
      ? formatRelativeTime(new Date(Date.now() + expiresMs).toISOString()).replace(' ago', '')
      : 'expiring now'
    return (
      <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-r from-primary/15 via-primary/10 to-primary/5 px-5 py-4">
        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-primary/5" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-primary">Elevated</h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <Clock className="h-2.5 w-2.5" /> expires in {expiresLabel}
                </span>
              </div>
              <p className="mt-1 text-sm text-primary/80 leading-relaxed">
                BrowserQuery floor raised to <strong>{elevate.browserQueryFloor ?? 'BrowserQuery'}</strong>. 
                Browser probes, cookie queries, DOM snapshots, and JS evaluation are temporarily enabled for all sessions.
              </p>
            </div>
          </div>
          {onClearElevate && (
            <Button variant="outline" size="sm" onClick={onClearElevate} className="shrink-0">
              Clear elevation
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-success/30 bg-gradient-to-r from-success/10 via-success/5 to-transparent px-5 py-4">
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/20">
          <ShieldCheck className="h-5 w-5 text-success" />
        </div>
        <div>
          <h3 className="text-base font-bold text-success">Normal</h3>
          <p className="mt-0.5 text-sm text-success/80">
            Diagnostics pipeline is healthy. All configured domain levels are active and events are being recorded.
          </p>
        </div>
      </div>
    </div>
  )
}
