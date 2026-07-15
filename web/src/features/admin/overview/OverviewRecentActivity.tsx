import { Link } from 'react-router-dom'
import { ArrowRight, Circle, TrendingUp } from 'lucide-react'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { cn } from '@/lib/utils'

interface OverviewRecentActivityProps {
  events: DiagnosticsEventRecord[]
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3600_000)}h ago`
}

function severityColor(severity: string): string {
  if (severity === 'Error') return 'text-destructive'
  if (severity === 'Warning') return 'text-warning'
  if (severity === 'Metric') return 'text-muted-foreground'
  return 'text-sky-500'
}

export function OverviewRecentActivity({ events }: OverviewRecentActivityProps) {
  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          Recent activity
        </CardTitle>
        <CardDescription>Last 30 minutes · {events.length} event{events.length !== 1 ? 's' : ''}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {events.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border py-10">
            <p className="text-sm text-muted-foreground">No recent events</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50 rounded-lg border border-border overflow-hidden">
            {events.map((evt) => (
              <div key={evt.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/20">
                <Circle className={cn('h-2 w-2 shrink-0 fill-current', severityColor(evt.severity))} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {evt.name.split('.').pop()}
                </span>
                <DomainBadge domain={evt.domain} showTooltip={false} />
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {relativeTime(evt.utc)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 pt-2 border-t border-border/50">
          <Link
            to="/admin/diagnostics/activity"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View activity
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
