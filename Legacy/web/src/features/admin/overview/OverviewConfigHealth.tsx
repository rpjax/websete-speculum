import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import type { DiagnosticsOverview } from '@/lib/diagnosticsApi'
import type { MotorOverviewConfig } from '@/lib/hooks/useMotorOverview'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface OverviewConfigHealthProps {
  config: MotorOverviewConfig
  scriptsCount: number
  diagnostics: DiagnosticsOverview | null
}

interface ConfigTile {
  id: string
  label: string
  href: string
  configured: boolean
  summary: string
}

function buildTiles(
  config: MotorOverviewConfig,
  scriptsCount: number,
  diagnostics: DiagnosticsOverview | null,
): ConfigTile[] {
  return [
    {
      id: 'forwarding',
      label: 'Forwarding',
      href: '/admin/forwarding',
      configured: !!config.forwarding?.host?.trim(),
      summary: config.forwarding?.host?.trim() || 'Not set',
    },
    {
      id: 'hosting',
      label: 'Hosting',
      href: '/admin/hosting',
      configured: (config.hosting?.profiles.length ?? 0) > 0,
      summary: config.hosting?.profiles.length
        ? `${config.hosting.profiles.length} profile${config.hosting.profiles.length !== 1 ? 's' : ''}`
        : 'No domains',
    },
    {
      id: 'maxSessions',
      label: 'Max sessions',
      href: '/admin/capacity',
      configured: config.maxSessions != null,
      summary: config.maxSessions != null ? `${config.maxSessions} slots` : 'Not set',
    },
    {
      id: 'sessionPolicy',
      label: 'Session policy',
      href: '/admin/capacity',
      configured: config.sessionPolicy != null,
      summary: config.sessionPolicy?.ttlDays != null
        ? `${config.sessionPolicy.ttlDays} day TTL`
        : 'Not set',
    },
    {
      id: 'jsBridge',
      label: 'JsBridge',
      href: '/admin/capacity',
      configured: config.jsBridge != null,
      summary: config.jsBridge?.enable ? 'Enabled' : 'Disabled',
    },
    {
      id: 'scriptInjection',
      label: 'Script injection',
      href: '/admin/script-injection',
      configured: (config.scriptInjection?.length ?? 0) > 0,
      summary: config.scriptInjection?.length
        ? `${config.scriptInjection.length} entr${config.scriptInjection.length !== 1 ? 'ies' : 'y'}`
        : 'None',
    },
    {
      id: 'scripts',
      label: 'Scripts',
      href: '/admin/scripts',
      configured: scriptsCount > 0,
      summary: scriptsCount > 0 ? `${scriptsCount} uploaded` : 'Empty library',
    },
    {
      id: 'diagnostics',
      label: 'Diagnostics',
      href: '/admin/diagnostics/config',
      configured: !!diagnostics?.enabled,
      summary: diagnostics?.enabled ? 'Pipeline on' : 'Off',
    },
  ]
}

export function OverviewConfigHealth({
  config,
  scriptsCount,
  diagnostics,
}: OverviewConfigHealthProps) {
  const tiles = buildTiles(config, scriptsCount, diagnostics)

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Configuration health</h2>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.id}
            to={tile.href}
            className={cn(
              'rounded-lg border border-border bg-card px-3 py-3 transition-colors hover:bg-muted/40',
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="text-xs font-medium">{tile.label}</span>
              {tile.configured ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-warning" />
              )}
            </div>
            <p className="truncate text-[11px] text-muted-foreground">{tile.summary}</p>
            <Badge
              variant={tile.configured ? 'success' : 'warning'}
              className="mt-2 text-[9px]"
            >
              {tile.configured ? 'Configured' : 'Missing'}
            </Badge>
          </Link>
        ))}
      </div>
    </section>
  )
}
