import { Link } from 'react-router-dom'
import { ArrowRight, Globe, Gauge, FileCode, ShieldCheck } from 'lucide-react'
import type { ConfigStatus } from '@/lib/api'
import type { MotorOverviewConfig } from '@/lib/hooks/useMotorOverview'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { profileBadge } from '@/lib/hostingStatus'

interface OverviewPlatformCardsProps {
  status: ConfigStatus | null
  config: MotorOverviewConfig
  scriptsCount: number
}

export function OverviewPlatformCards({
  status,
  config,
  scriptsCount,
}: OverviewPlatformCardsProps) {
  const profiles = status?.hosting?.profiles ?? []
  const injectionCount = config.scriptInjection?.length ?? 0

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Platform summary</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {/* Edge & hosting */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                Edge & hosting
              </span>
              <Link to="/admin/hosting" className="text-xs font-normal text-primary hover:underline">
                Manage
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <p className="text-[11px] text-muted-foreground">Forwarding target</p>
              <p className="font-medium truncate">
                {config.forwarding?.host?.trim() || 'Not configured'}
              </p>
            </div>
            {profiles.length === 0 ? (
              <p className="text-xs text-muted-foreground">No hosting profiles</p>
            ) : (
              profiles.map((p) => {
                const b = profileBadge(p)
                return (
                  <div key={p.domain} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-xs">
                      {p.subdomainMirroringEnabled
                        ? <ShieldCheck className="h-3 w-3 shrink-0 text-muted-foreground" />
                        : <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
                      }
                      {p.domain}
                    </span>
                    <Badge variant={b.tone} className="text-[9px] shrink-0">{b.label}</Badge>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        {/* Capacity */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                Capacity
              </span>
              <Link to="/admin/capacity" className="text-xs font-normal text-primary hover:underline">
                Configure
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Max sessions</span>
              <span className="font-medium tabular-nums">
                {config.maxSessions ?? '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Session TTL</span>
              <span className="font-medium tabular-nums">
                {config.sessionPolicy?.ttlDays != null
                  ? `${config.sessionPolicy.ttlDays} days`
                  : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">JsBridge</span>
              <Badge variant={config.jsBridge?.enable ? 'success' : 'muted'} className="text-[9px]">
                {config.jsBridge?.enable ? 'On' : 'Off'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Automation */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-muted-foreground" />
                Automation
              </span>
              <Link to="/admin/scripts" className="text-xs font-normal text-primary hover:underline">
                Scripts
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Script library</span>
              <span className="font-medium tabular-nums">{scriptsCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Injection entries</span>
              <span className="font-medium tabular-nums">{injectionCount}</span>
            </div>
            {injectionCount > 0 && config.scriptInjection && (
              <p className="text-[11px] text-muted-foreground pt-1">
                {config.scriptInjection.map((e) => e.position).join(', ')}
              </p>
            )}
            <Link
              to="/admin/script-injection"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline pt-1"
            >
              Script injection
              <ArrowRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
