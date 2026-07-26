import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { diagnosticsApi, type DiagnosticsOverview, type DiagnosticsRuntimeSnapshot } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { HealthScoreGauge, computeHealthScore } from '@/components/admin/HealthScoreGauge'
import { QuickActions } from '@/components/admin/QuickActions'
import {
  formatBytes, formatRelativeTime, DOMAIN_LABELS,
  CAPABILITY_LABELS, countCapabilities, summarizeCapabilities,
} from '@/lib/diagnosticsConstants'
import { humanizeDomain } from '@/lib/diagnosticsDescriptions'
import { cn } from '@/lib/utils'
import {
  RefreshCw, AlertTriangle, Eye, EyeOff, HelpCircle,
  ShieldCheck, ShieldAlert, Zap, Clock, Database, HardDrive,
  ArrowUpCircle, ArrowDownCircle, Layers,
  CheckCircle2, XCircle, Gauge,
} from 'lucide-react'

export default function DiagnosticsSystemHealthPage() {
  const [overview, setOverview] = useState<DiagnosticsOverview | null>(null)
  const [runtime, setRuntime] = useState<DiagnosticsRuntimeSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recovering, setRecovering] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [ov, rt] = await Promise.all([
        diagnosticsApi.getOverview(),
        diagnosticsApi.getRuntime(),
      ])
      setOverview(ov)
      setRuntime(rt)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load health data')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function handleRecover() {
    setRecovering(true)
    try { await diagnosticsApi.recover(); await refresh() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Recovery failed') }
    finally { setRecovering(false) }
  }

  async function handleClearElevate() {
    try { await diagnosticsApi.clearElevate(); await refresh() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Clear elevate failed') }
  }

  if (!overview && !error) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-lg" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      </div>
    )
  }

  if (error && !overview) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
        <AlertTriangle className="mx-auto h-7 w-7 text-destructive" />
        <p className="mt-2 text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void refresh()}>Retry</Button>
      </div>
    )
  }

  const ov = overview!
  const storageMaxBytes = ov.storageMaxBytes
  const storagePercent = storageMaxBytes > 0 ? Math.round((ov.bytesUsed / storageMaxBytes) * 100) : 0
  const caps = countCapabilities(ov.effectiveCapabilities)
  const domainsOff = Object.values(ov.effectiveCapabilities).filter((c) => summarizeCapabilities(c).off).length
  const totalDomains = Object.keys(ov.effectiveCapabilities).length
  const domainsActive = totalDomains - domainsOff

  const healthScore = computeHealthScore({
    degraded: ov.degraded,
    eventsDropped: ov.eventsDropped,
    overflowCount: ov.overflowCount,
    liveSessions: ov.liveSessions.activeCount,
    storagePercent,
    capabilitiesOff: caps.off,
    totalCapabilities: caps.total,
  })

  const isDegraded = ov.degraded
  const isElevated = !isDegraded && ov.elevate?.active

  return (
    <div className="space-y-6">
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Actions bar */}
      <div className="flex items-center justify-between">
        <QuickActions onRefresh={refresh} />
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void refresh()}>
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>

      {/* Health hero — score + circuit state */}
      <div className={cn(
        'relative overflow-hidden rounded-lg border',
        isDegraded ? 'border-red-500/30 bg-gradient-to-r from-red-500/10 via-red-500/5 to-card'
          : isElevated ? 'border-blue-500/30 bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-card'
          : 'border-emerald-500/30 bg-gradient-to-r from-emerald-500/8 via-emerald-500/4 to-card',
      )}>
        <div className="flex items-center gap-5 px-5 py-4">
          <HealthScoreGauge score={healthScore} size={80} />
          <div className="h-14 w-px rounded-full bg-border/40" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {isDegraded ? (
                <><ShieldAlert className="h-4 w-4 text-red-400" /><span className="text-sm font-bold text-red-400">Degraded</span></>
              ) : isElevated ? (
                <><Zap className="h-4 w-4 text-blue-400" /><span className="text-sm font-bold text-blue-400">Elevated</span></>
              ) : (
                <><ShieldCheck className="h-4 w-4 text-emerald-400" /><span className="text-sm font-bold text-emerald-400">Healthy</span></>
              )}
              {isDegraded && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 animate-pulse">Action required</Badge>
              )}
              {isElevated && ov.elevate?.expiresUtc && (
                <Badge variant="muted" className="gap-1 text-[10px] px-1.5 py-0">
                  <Clock className="h-2.5 w-2.5" /> Expires {formatRelativeTime(ov.elevate.expiresUtc)}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {isDegraded
                ? 'Circuit breaker tripped. Capabilities are capped at Metric — events, snapshots, and probes are unavailable until recovery.'
                : isElevated
                ? 'Browser Query is temporarily unlocked. Deep browser inspection (cookies, DOM, JS) is available across sessions.'
                : 'Diagnostics pipeline is healthy. All configured capabilities are active and events are being recorded.'}
            </p>
          </div>

          {isDegraded && (
            <Button variant="destructive" size="sm" onClick={handleRecover} disabled={recovering} className="shrink-0">
              {recovering ? 'Recovering…' : 'Recover'}
            </Button>
          )}
          {isElevated && (
            <Button variant="outline" size="sm" onClick={handleClearElevate} className="shrink-0">Clear</Button>
          )}
        </div>
      </div>

      {/* Attention banner */}
      {ov.needsAttention.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <p className="text-xs font-bold text-warning">Action required</p>
              <ul className="mt-1 space-y-0.5">
                {ov.needsAttention.map((msg) => (
                  <li key={msg} className="text-xs text-warning/80">{msg}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                <HelpCircle className="mr-0.5 inline h-3 w-3" />
                Adjust in <Link to="/admin/diagnostics/governance" className="text-primary hover:underline">Governance</Link>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* System checks grid */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Gauge className="h-3 w-3" /> System checks
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <HealthCheck
            label="Circuit breaker"
            ok={!ov.degraded}
            detail={ov.degraded ? 'Tripped — probes and events capped' : 'Normal operation'}
          />
          <HealthCheck
            label="Event pipeline"
            ok={ov.eventsDropped === 0}
            detail={ov.eventsDropped > 0 ? `${ov.eventsDropped} events dropped` : `${ov.eventsStored.toLocaleString()} events stored`}
          />
          <HealthCheck
            label="Storage buffer"
            ok={storagePercent < 80}
            warn={storagePercent >= 80 && storagePercent < 95}
            detail={`${formatBytes(ov.bytesUsed)} / ${formatBytes(storageMaxBytes)} (${storagePercent}%)`}
          />
          <HealthCheck
            label="Overflow"
            ok={ov.overflowCount === 0}
            detail={ov.overflowCount > 0 ? `${ov.overflowCount} overflow(s) — oldest events dropped` : 'No data loss'}
          />
          <HealthCheck
            label="Observation coverage"
            ok={domainsOff === 0}
            warn={domainsOff > 0 && domainsOff < totalDomains}
            detail={domainsOff === 0 ? `All ${totalDomains} domains active` : `${domainsOff} of ${totalDomains} domains off`}
          />
          <HealthCheck
            label="Probe availability"
            ok={!ov.degraded && ov.probeInFlight === 0}
            detail={ov.degraded ? 'Unavailable — circuit degraded' : ov.probeInFlight > 0 ? `${ov.probeInFlight} in flight` : 'Ready'}
          />
        </div>
      </div>

      {/* Storage & pipeline metrics */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Database className="h-3 w-3" /> Storage & pipeline
        </p>
        <div className="rounded-lg border border-border overflow-hidden divide-y divide-border/40">
          <MetricRow icon={<Database className="h-3.5 w-3.5" />} label="Events stored" value={ov.eventsStored.toLocaleString()} />
          <MetricRow icon={<HardDrive className="h-3.5 w-3.5" />} label="Buffer usage" value={`${formatBytes(ov.bytesUsed)} / ${formatBytes(storageMaxBytes)}`}>
            <div className="w-24 h-1.5 rounded-full bg-muted/30 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', storagePercent > 80 ? 'bg-warning' : 'bg-primary')}
                style={{ width: `${Math.max(storagePercent, 1)}%` }}
              />
            </div>
          </MetricRow>
          <MetricRow icon={<ArrowDownCircle className="h-3.5 w-3.5" />} label="Events dropped" value={ov.eventsDropped} tone={ov.eventsDropped > 0 ? 'destructive' : undefined} />
          <MetricRow icon={<ArrowUpCircle className="h-3.5 w-3.5" />} label="Overflow count" value={ov.overflowCount} tone={ov.overflowCount > 0 ? 'warning' : undefined} />
          <MetricRow icon={<Clock className="h-3.5 w-3.5" />} label="Last cleanup" value={ov.lastCleanupUtc ? formatRelativeTime(ov.lastCleanupUtc) : 'Never'} />
          <MetricRow icon={<Zap className="h-3.5 w-3.5" />} label="Probes in flight" value={ov.probeInFlight} />
        </div>
      </div>

      {/* Observation coverage — per-domain capability toggles */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Layers className="h-3 w-3" /> Observation coverage
          </p>
          <span className="text-[11px] text-muted-foreground">{domainsActive}/{totalDomains} domains active</span>
        </div>
        <div className="rounded-lg border border-border overflow-hidden divide-y divide-border/40">
          {Object.entries(ov.effectiveCapabilities).map(([domain, capMap]) => {
            const { enabled, off } = summarizeCapabilities(capMap)
            return (
              <div key={domain} className={cn('flex items-center gap-3 px-4 py-2 hover:bg-muted/5', off && 'opacity-50')}>
                <div className={cn('shrink-0', off ? 'text-muted-foreground/50' : 'text-blue-400')}>
                  {off ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{DOMAIN_LABELS[domain] ?? domain}</span>
                  <p className="truncate text-[11px] text-muted-foreground">{humanizeDomain(domain)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {off ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">Off</span>
                  ) : (
                    enabled.map((cap) => (
                      <span key={cap} className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-bold',
                        cap === 'Probe' ? 'bg-violet-500/15 text-violet-400' : 'bg-blue-500/10 text-blue-400',
                      )}>
                        {CAPABILITY_LABELS[cap] ?? cap}
                      </span>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Runtime metadata */}
      {runtime && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <HelpCircle className="h-3 w-3" /> Runtime
          </p>
          <div className="rounded-lg border border-border overflow-hidden divide-y divide-border/40">
            <MetricRow icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Enabled" value={runtime.enabled ? 'Yes' : 'No'} />
            <MetricRow icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Redaction mode" value={runtime.redactionMode} />
            <MetricRow icon={<Database className="h-3.5 w-3.5" />} label="Schema version" value={`v${runtime.diagnosticsSchemaVersion}`} />
          </div>
        </div>
      )}
    </div>
  )
}

function HealthCheck({ label, ok, warn, detail }: { label: string; ok: boolean; warn?: boolean; detail: string }) {
  const isWarn = !ok && warn
  const isFail = !ok && !warn
  return (
    <div className={cn(
      'flex items-center gap-2.5 rounded-lg border px-3 py-2.5',
      isFail ? 'border-red-500/20 bg-red-500/5' : isWarn ? 'border-amber-500/20 bg-amber-500/5' : 'border-border bg-card',
    )}>
      {isFail ? <XCircle className="h-4 w-4 shrink-0 text-red-400" />
        : isWarn ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">{label}</p>
        <p className="truncate text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function MetricRow({ icon, label, value, tone, children }: {
  icon: React.ReactNode
  label: string
  value: string | number
  tone?: 'destructive' | 'warning'
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 hover:bg-muted/5">
      <div className="text-muted-foreground/60">{icon}</div>
      <span className="flex-1 text-xs text-muted-foreground">{label}</span>
      {children}
      <span className={cn(
        'text-sm font-semibold tabular-nums',
        tone === 'destructive' ? 'text-red-400' : tone === 'warning' ? 'text-amber-400' : '',
      )}>
        {value}
      </span>
    </div>
  )
}
