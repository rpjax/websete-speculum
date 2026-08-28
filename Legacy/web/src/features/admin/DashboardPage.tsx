import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/admin/PageHeader'
import { useMotorOverview } from '@/lib/hooks/useMotorOverview'
import { OverviewHero } from './overview/OverviewHero'
import { OverviewAttention } from './overview/OverviewAttention'
import { OverviewLiveSessions } from './overview/OverviewLiveSessions'
import { OverviewRecentActivity } from './overview/OverviewRecentActivity'
import { OverviewConfigHealth } from './overview/OverviewConfigHealth'
import { OverviewPlatformCards } from './overview/OverviewPlatformCards'

function formatLastUpdated(date: Date | null): string {
  if (!date) return ''
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return 'Updated just now'
  return `Updated ${Math.floor(diff / 60_000)}m ago`
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="flex gap-4">
        <Skeleton className="h-28 w-28 shrink-0 rounded-full" />
        <div className="grid flex-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24 hidden lg:block" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-48" />
    </div>
  )
}

export default function DashboardPage() {
  const overview = useMotorOverview()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Motor overview"
        description="System health, live sessions, configuration, and recent activity — all in one place."
        actions={
          <div className="flex items-center gap-3">
            {overview.lastUpdated && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatLastUpdated(overview.lastUpdated)}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={overview.refresh}
              disabled={overview.loading}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        }
      />

      {overview.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{overview.error}</p>
        </div>
      )}

      {overview.loading && !overview.status ? (
        <OverviewSkeleton />
      ) : (
        <>
          <OverviewHero
            status={overview.status}
            diagnostics={overview.diagnostics}
            healthScore={overview.healthScore}
            persistedCount={overview.persistedCount}
            configuredCount={overview.configuredCount}
            storagePercent={overview.storagePercent}
          />

          <OverviewAttention
            status={overview.status}
            diagnostics={overview.diagnostics}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <OverviewLiveSessions sessions={overview.liveSessions} />
            <OverviewRecentActivity events={overview.recentEvents} />
          </div>

          <OverviewConfigHealth
            config={overview.config}
            scriptsCount={overview.scriptsCount}
            diagnostics={overview.diagnostics}
          />

          <OverviewPlatformCards
            status={overview.status}
            config={overview.config}
            scriptsCount={overview.scriptsCount}
          />
        </>
      )}
    </div>
  )
}
