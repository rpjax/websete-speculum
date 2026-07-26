import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowRight, Settings } from 'lucide-react'
import type { ConfigStatus } from '@/lib/api'
import type { DiagnosticsOverview } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SECTION_HELP } from '@/lib/hostingStatus'

interface OverviewAttentionProps {
  status: ConfigStatus | null
  diagnostics: DiagnosticsOverview | null
}

export function OverviewAttention({ status, diagnostics }: OverviewAttentionProps) {
  const missing = status?.missing ?? []
  const degraded = diagnostics?.degraded ?? false
  const needsAttention = diagnostics?.needsAttention ?? []

  if (missing.length === 0 && !degraded && needsAttention.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Needs attention
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {missing.map((section) => {
          const help = SECTION_HELP[section]
          return (
            <div
              key={section}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{section}</p>
                  <p className="text-xs text-muted-foreground">Required configuration is missing</p>
                </div>
              </div>
              {help && (
                <Button asChild size="sm" variant="outline" className="shrink-0 gap-1">
                  <Link to={help.href}>
                    Configure
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              )}
            </div>
          )
        })}

        {degraded && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Activity className="h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Diagnostics degraded</p>
                <p className="text-xs text-muted-foreground">Probes may be capped until recovered</p>
              </div>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0 gap-1">
              <Link to="/admin/diagnostics">
                Recover
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        )}

        {needsAttention
          .filter(() => !degraded)
          .map((msg, i) => (
            <p key={i} className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-muted-foreground">
              {msg}
            </p>
          ))}
      </CardContent>
    </Card>
  )
}
