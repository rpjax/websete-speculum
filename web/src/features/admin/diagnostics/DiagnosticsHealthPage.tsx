import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { diagnosticsApi, type DiagnosticsOverview, type DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/admin/StatCard'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { SeverityBadge } from '@/components/admin/SeverityBadge'
import { HealthScoreGauge, computeHealthScore } from '@/components/admin/HealthScoreGauge'
import { Sparkline } from '@/components/admin/Sparkline'
import { EventFrequencyChart, TimeDistributionChart } from '@/components/admin/EventFrequencyChart'
import { QuickActions } from '@/components/admin/QuickActions'
import { ExportButton } from '@/components/admin/ExportButton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEventStats } from '@/lib/hooks/useEventStats'
import { formatBytes, formatRelativeTime, DOMAIN_LABELS, LEVEL_LABELS, LEVEL_DESCRIPTIONS, DOMAIN_COLORS } from '@/lib/diagnosticsConstants'
import { describeEvent, humanizeDomain } from '@/lib/diagnosticsDescriptions'
import {
  ArrowRight, RefreshCw, Database, HardDrive, Monitor,
  AlertTriangle, Layers, Eye, EyeOff, Activity,
  Clock, TrendingUp, BookOpen, HelpCircle, Zap,
  BarChart3, GitBranch, Users, Hash,
  ShieldCheck, ShieldAlert, Maximize2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export default function DiagnosticsHealthPage() {
  const [overview, setOverview] = useState<DiagnosticsOverview | null>(null)
  const [recentEvents, setRecentEvents] = useState<DiagnosticsEventRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [recovering, setRecovering] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [ov, events] = await Promise.all([
        diagnosticsApi.getOverview(),
        diagnosticsApi.listEvents({ since: new Date(Date.now() - 60 * 60_000).toISOString() }),
      ])
      setOverview(ov)
      setRecentEvents(events)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load health data')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const stats = useEventStats(recentEvents)

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
      <div className="space-y-6">
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}
        </div>
      </div>
    )
  }

  if (error && !overview) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
        <p className="mt-2 text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void refresh()}>Retry</Button>
      </div>
    )
  }

  const ov = overview!
  const storageMaxBytes = 64 * 1024 * 1024
  const storagePercent = Math.round((ov.bytesUsed / storageMaxBytes) * 100)
  const levelsOff = Object.values(ov.effectiveLevels).filter((l) => l === 'Off').length
  const totalLevels = Object.keys(ov.effectiveLevels).length

  const healthScore = computeHealthScore({
    degraded: ov.degraded,
    eventsDropped: ov.eventsDropped,
    overflowCount: ov.overflowCount,
    liveSessions: ov.liveSessions.activeCount,
    storagePercent,
    levelsOff,
    totalLevels,
  })

  const displayEvents = recentEvents.slice(0, 8)

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Explanation + quick actions header */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
        <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="flex-1 text-sm leading-relaxed text-primary/90">
          <p>
            Your motor's <strong>health dashboard</strong>. Shows system state, collection metrics, and observation levels.
            {ov.degraded && <> <strong className="text-destructive">System is degraded.</strong></>}
            {ov.elevate?.active && <> <strong className="text-primary">BrowserQuery elevated.</strong></>}
          </p>
        </div>
      </div>

      {/* Quick actions bar */}
      <div className="flex items-center justify-between">
        <QuickActions onRefresh={refresh} />
        <div className="flex items-center gap-2">
          <ExportButton data={recentEvents} filename="diagnostics-health" />
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void refresh()}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {/* Unified health hero */}
      <HealthHero
        score={healthScore}
        degraded={ov.degraded}
        elevate={ov.elevate}
        onRecover={handleRecover}
        onClearElevate={handleClearElevate}
        recovering={recovering}
      />

      {/* Key metrics + sparklines */}
      <div>
        <SectionHeading
          icon={<TrendingUp className="h-4 w-4" />}
          title="Key metrics"
          description="Current state of the diagnostics event store and active sessions"
        />
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Events stored"
            value={ov.eventsStored.toLocaleString()}
            icon={<Database className="h-4 w-4" />}
            sub={
              <span className="flex items-center gap-2">
                <span>{ov.lastCleanupUtc ? `Cleanup ${formatRelativeTime(ov.lastCleanupUtc)}` : 'No cleanup yet'}</span>
                {stats.rateOverTime.length > 2 && (
                  <Sparkline data={stats.rateOverTime} width={60} height={16} colorClass="text-blue-400" label="Event rate" showFill />
                )}
              </span>
            }
            tooltip="Total diagnostic events in the ring buffer. The sparkline shows the event rate trend over the last hour."
          />
          <StatCard
            label="Storage used"
            value={formatBytes(ov.bytesUsed)}
            icon={<HardDrive className="h-4 w-4" />}
            sub={`${formatBytes(storageMaxBytes)} limit`}
            progress={storagePercent}
            tooltip="Memory consumed by diagnostic events. Configure limits in Governance."
            tone={storagePercent > 80 ? 'warning' : 'default'}
          />
          <StatCard
            label="Live sessions"
            value={ov.liveSessions.activeCount}
            icon={<Monitor className="h-4 w-4" />}
            sub={ov.liveSessions.startingCount > 0 ? `${ov.liveSessions.startingCount} starting up` : 'All sessions stable'}
            tooltip="Active remote browser sessions being served to users right now."
            tone="success"
          />
          <StatCard
            label="Events dropped"
            value={ov.eventsDropped}
            icon={<AlertTriangle className="h-4 w-4" />}
            sub={ov.overflowCount > 0 ? `${ov.overflowCount} overflow${ov.overflowCount !== 1 ? 's' : ''}` : 'No data loss'}
            tooltip="Events lost because the buffer was full. Increase maxBytes in Governance → Advanced."
            tone={ov.eventsDropped > 0 ? 'destructive' : 'default'}
          />
        </div>
      </div>

      {/* Activity summary strip */}
      {stats.total > 0 && (
        <div className="grid gap-3 sm:grid-cols-4">
          <MiniStat icon={<BarChart3 className="h-3.5 w-3.5" />} label="Event rate" value={`${stats.eventRate}/min`} />
          <MiniStat icon={<Users className="h-3.5 w-3.5" />} label="Unique sessions" value={stats.uniqueConnections} />
          <MiniStat icon={<GitBranch className="h-3.5 w-3.5" />} label="Correlations" value={stats.uniqueCorrelations} />
          <MiniStat icon={<Hash className="h-3.5 w-3.5" />} label="Event types" value={Object.keys(stats.byName).length} />
        </div>
      )}

      {/* Needs attention */}
      {ov.needsAttention.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-gradient-to-r from-warning/10 to-transparent p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/20">
              <AlertTriangle className="h-4 w-4 text-warning" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-warning">Action required</h3>
              <ul className="mt-1.5 space-y-1.5">
                {ov.needsAttention.map((msg) => (
                  <li key={msg} className="text-sm text-warning/80 leading-relaxed">{msg}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                <HelpCircle className="mr-1 inline h-3 w-3" />
                Use the <Link to="/admin/diagnostics/governance" className="text-primary hover:underline">Governance tab</Link> to adjust settings.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Observation levels — compact table-like rows */}
      <div>
        <SectionHeading
          icon={<Layers className="h-4 w-4" />}
          title="Observation levels"
          description="Each domain's current data collection depth — controls how much data is captured"
        />
        <div className="mt-3 rounded-xl border border-border bg-card overflow-hidden">
          {Object.entries(ov.effectiveLevels).map(([domain, level], i, arr) => {
            const domainLabel = DOMAIN_LABELS[domain] ?? domain
            const levelLabel = LEVEL_LABELS[level] ?? level
            const humanDesc = humanizeDomain(domain)
            const isOff = level === 'Off'
            const isBQ = level === 'BrowserQuery'
            const isLast = i === arr.length - 1

            return (
              <div
                key={domain}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/10',
                  !isLast && 'border-b border-border/40',
                  isOff && 'opacity-50',
                )}
              >
                <div className={cn('shrink-0', isOff ? 'text-muted-foreground' : 'text-blue-400')}>
                  {isOff ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{domainLabel}</span>
                  <p className="truncate text-[11px] text-muted-foreground">{humanDesc}</p>
                </div>
                <span className={cn(
                  'shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold',
                  isBQ ? 'bg-violet-500/15 text-violet-400'
                    : isOff ? 'bg-muted text-muted-foreground'
                    : 'bg-blue-500/10 text-blue-400',
                )}>
                  {levelLabel}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Charts — side by side, compact */}
      {stats.total > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <BarChart3 className="h-3 w-3" /> By domain
            </p>
            <EventFrequencyChart events={recentEvents} groupBy="domain" />
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <BarChart3 className="h-3 w-3" /> By severity
            </p>
            <EventFrequencyChart events={recentEvents} groupBy="severity" />
          </div>
        </div>
      )}

      {/* Time distribution chart — inline with link to full page */}
      {stats.total > 2 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Activity className="h-3 w-3" /> Timeline
            </p>
            <Link
              to="/admin/diagnostics/timeline"
              className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80"
            >
              Full timeline <Maximize2 className="h-3 w-3" />
            </Link>
          </div>
          <TimeDistributionChart events={recentEvents} height={90} buckets={36} />
        </div>
      )}

      {/* Recent activity — compact feed */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3 w-3" /> Recent activity
          </p>
          <Link to="/admin/diagnostics/activity" className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {displayEvents.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-muted-foreground">
            <Clock className="h-4 w-4 text-muted-foreground/40" />
            No events in the last hour
          </div>
        ) : (
          <div>
            {displayEvents.map((evt, i) => {
              const isLast = i === displayEvents.length - 1
              const dotColor = evt.severity === 'Error' ? 'bg-red-500'
                : evt.severity === 'Warning' ? 'bg-amber-500'
                : evt.severity === 'Metric' ? 'bg-slate-400'
                : 'bg-sky-500'
              return (
                <Tooltip key={evt.id}>
                  <TooltipTrigger asChild>
                    <div className={cn(
                      'flex items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/20',
                      !isLast && 'border-b border-border/20',
                    )}>
                      <div className={cn('h-2 w-2 shrink-0 rounded-full', dotColor)} />
                      <span className="w-12 shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
                        {formatRelativeTime(evt.utc)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{evt.name.split('.').pop()}</span>
                      <DomainBadge domain={evt.domain} showTooltip={false} />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-sm text-xs">
                    <p className="font-bold">{evt.name}</p>
                    <p className="mt-1 text-muted-foreground">{describeEvent(evt.name)}</p>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            Probes in flight: <span className="font-medium text-foreground">{ov.probeInFlight}</span>
          </span>
          <span className="hidden text-border sm:inline">|</span>
          <span className="hidden sm:inline">Schema v{ov.diagnosticsSchemaVersion}</span>
          <span className="hidden text-border sm:inline">|</span>
          <span className="hidden sm:inline">Redaction: <span className="font-medium text-foreground">{ov.redactionMode}</span></span>
        </div>
      </div>
    </div>
  )
}

function SectionHeading({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div>
        <h3 className="text-sm font-bold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="text-muted-foreground">{icon}</div>
      <div>
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="text-sm font-bold tabular-nums">{value}</p>
      </div>
    </div>
  )
}

function HealthHero({ score, degraded, elevate, onRecover, onClearElevate, recovering }: {
  score: number
  degraded: boolean
  elevate: { active?: boolean; browserQueryFloor?: string; expiresUtc?: string } | null
  onRecover: () => void
  onClearElevate: () => void
  recovering: boolean
}) {
  const isDegraded = degraded
  const isElevated = !isDegraded && elevate?.active
  const isNormal = !isDegraded && !isElevated

  const borderClass = isDegraded ? 'border-red-500/30' : isElevated ? 'border-blue-500/30' : 'border-emerald-500/30'
  const bgClass = isDegraded
    ? 'bg-gradient-to-r from-red-500/10 via-red-500/5 to-card'
    : isElevated
    ? 'bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-card'
    : 'bg-gradient-to-r from-emerald-500/8 via-emerald-500/4 to-card'

  const stateLabel = isDegraded ? 'Degraded' : isElevated ? 'Elevated' : 'Normal'
  const stateLabelClass = isDegraded ? 'text-red-400' : isElevated ? 'text-blue-400' : 'text-emerald-400'
  const StateIcon = isDegraded ? ShieldAlert : isElevated ? Zap : ShieldCheck

  let description = 'Diagnostics pipeline is healthy. All configured domain levels are active and events are being recorded.'
  if (isDegraded) {
    description = 'The diagnostics circuit breaker has tripped. Effective levels are capped at Metrics — event recording and browser probes are unavailable until recovery.'
  } else if (isElevated && elevate?.expiresUtc) {
    const expiresMs = new Date(elevate.expiresUtc).getTime() - Date.now()
    const mins = Math.max(1, Math.round(expiresMs / 60_000))
    description = `BrowserQuery floor raised to ${elevate.browserQueryFloor ?? 'BrowserQuery'}. Deep browser inspection enabled for all sessions — expires in ~${mins} min.`
  }

  return (
    <div className={cn('relative overflow-hidden rounded-xl border', borderClass, bgClass)}>
      <div className="relative flex items-center gap-5 px-5 py-4">
        <div className="shrink-0">
          <HealthScoreGauge score={score} size={76} />
        </div>

        <div className="h-12 w-px rounded-full bg-border/40" />

        {/* State info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <div className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md',
              isDegraded ? 'bg-red-500/15' : isElevated ? 'bg-blue-500/15' : 'bg-emerald-500/15',
            )}>
              <StateIcon className={cn('h-3.5 w-3.5', stateLabelClass)} />
            </div>
            <h3 className={cn('text-sm font-bold tracking-wide', stateLabelClass)}>{stateLabel}</h3>
            {isDegraded && (
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-400 animate-pulse">
                Action required
              </span>
            )}
            {isElevated && (
              <span className="flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                <Clock className="h-2.5 w-2.5" /> Temporary
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        </div>

        {/* Action button */}
        {isDegraded && onRecover && (
          <Button variant="destructive" size="sm" onClick={onRecover} disabled={recovering} className="shrink-0">
            {recovering ? 'Recovering…' : 'Recover'}
          </Button>
        )}
        {isElevated && onClearElevate && (
          <Button variant="outline" size="sm" onClick={onClearElevate} className="shrink-0">
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}
