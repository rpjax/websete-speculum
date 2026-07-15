import { Link } from 'react-router-dom'
import { ArrowRight, MonitorPlay, Radio } from 'lucide-react'
import type { MotorSessionListItem } from '@/lib/diagnosticsApi'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FpsIndicator, UptimeBar } from '@/components/admin/UptimeBar'
import { humanizeConnectionId } from '@/lib/diagnosticsDescriptions'
import { cn } from '@/lib/utils'

interface OverviewLiveSessionsProps {
  sessions: MotorSessionListItem[]
}

function phaseTone(phase: string, starting: boolean): 'success' | 'warning' | 'muted' {
  if (starting) return 'warning'
  if (phase === 'Running') return 'success'
  return 'muted'
}

export function OverviewLiveSessions({ sessions }: OverviewLiveSessionsProps) {
  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorPlay className="h-4 w-4 text-muted-foreground" />
          Live sessions
        </CardTitle>
        <CardDescription>
          {sessions.length === 0
            ? 'No motor connections active'
            : `${sessions.length} connection${sessions.length !== 1 ? 's' : ''} right now`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {sessions.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
            <Radio className="h-8 w-8 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">No active sessions</p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link to="/">Open Motor</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <Link
                key={s.connectionId}
                to={`/admin/sessions/${s.connectionId}`}
                className="group block rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="truncate text-sm font-medium">
                    {humanizeConnectionId(s.connectionId)}
                  </span>
                  <Badge variant={phaseTone(s.phase, s.starting)}>
                    {s.starting ? 'Starting' : s.phase}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground mb-2">{s.currentUrl || '—'}</p>
                <div className="flex items-center gap-3">
                  {s.fps != null && <FpsIndicator fps={s.fps} />}
                  {s.uptimeMs != null && (
                    <UptimeBar uptimeMs={s.uptimeMs} className="flex-1 min-w-0" />
                  )}
                  <ArrowRight className={cn(
                    'h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity',
                    'group-hover:opacity-100',
                  )} />
                </div>
              </Link>
            ))}
          </div>
        )}
        <div className="mt-4 pt-2 border-t border-border/50">
          <Link
            to="/admin/diagnostics/sessions"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View all live sessions
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
