import { Link } from 'react-router-dom'
import {
  Activity,
  Database,
  HardDrive,
  MonitorPlay,
  Settings,
} from 'lucide-react'
import type { ConfigStatus } from '@/lib/api'
import type { DiagnosticsOverview } from '@/lib/diagnosticsApi'
import { HealthScoreGauge } from '@/components/admin/HealthScoreGauge'
import { SystemStateBanner } from '@/components/admin/SystemStateBanner'
import { StatCard } from '@/components/admin/StatCard'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface OverviewHeroProps {
  status: ConfigStatus | null
  diagnostics: DiagnosticsOverview | null
  healthScore: number
  persistedCount: number
  configuredCount: number
  storagePercent: number
}

export function OverviewHero({
  status,
  diagnostics,
  healthScore,
  persistedCount,
  configuredCount,
  storagePercent,
}: OverviewHeroProps) {
  const liveCount = diagnostics?.liveSessions.activeCount ?? 0
  const startingCount = diagnostics?.liveSessions.startingCount ?? 0
  const operational = status?.operational ?? false

  return (
    <section className="space-y-4">
      {diagnostics && (
        <SystemStateBanner
          degraded={diagnostics.degraded}
          elevate={diagnostics.elevate}
        />
      )}

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 md:flex-row md:items-center">
        <HealthScoreGauge score={healthScore} size={100} className="shrink-0" />

        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Link to="/admin/diagnostics/sessions" className="block transition-opacity hover:opacity-90">
            <StatCard
              label="Live sessions"
              value={liveCount}
              icon={<MonitorPlay className="h-4 w-4" />}
              tone={liveCount > 0 ? 'success' : 'default'}
              sub={startingCount > 0 ? `+${startingCount} starting` : 'active now'}
            />
          </Link>
          <Link to="/admin/sessions" className="block transition-opacity hover:opacity-90">
            <StatCard
              label="Persisted"
              value={persistedCount}
              icon={<Database className="h-4 w-4" />}
              tone="default"
              sub="stored sessions"
            />
          </Link>
          <Link to="/admin/diagnostics/activity" className="block transition-opacity hover:opacity-90">
            <StatCard
              label="Events"
              value={diagnostics?.eventsStored.toLocaleString() ?? '—'}
              icon={<Activity className="h-4 w-4" />}
              tone="default"
              sub={diagnostics?.eventsDropped ? `${diagnostics.eventsDropped} dropped` : 'stored'}
            />
          </Link>
          <Link to="/admin/diagnostics" className="block transition-opacity hover:opacity-90">
            <StatCard
              label="Storage"
              value={diagnostics ? formatBytes(diagnostics.bytesUsed) : '—'}
              icon={<HardDrive className="h-4 w-4" />}
              tone={storagePercent > 90 ? 'destructive' : storagePercent > 70 ? 'warning' : 'default'}
              sub="of 64 MB budget"
              progress={storagePercent}
              tooltip="Diagnostics event storage usage"
            />
          </Link>
          <Link to="/admin/hosting" className="block transition-opacity hover:opacity-90">
            <StatCard
              label="Configuration"
              value={`${configuredCount}/8`}
              icon={<Settings className="h-4 w-4" />}
              tone={configuredCount >= 8 ? 'success' : configuredCount >= 5 ? 'warning' : 'destructive'}
              sub={operational ? 'operational' : 'needs setup'}
            />
          </Link>
        </div>
      </div>
    </section>
  )
}
