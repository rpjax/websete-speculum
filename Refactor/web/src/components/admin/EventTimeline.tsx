import { Badge } from '@/components/ui/badge'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

function severityTone(severity: string): 'success' | 'warning' | 'destructive' | 'muted' | 'default' {
  const s = severity.toLowerCase()
  if (s.includes('error') || s.includes('fault') || s.includes('critical')) return 'destructive'
  if (s.includes('warn')) return 'warning'
  if (s.includes('info') || s.includes('metric')) return 'muted'
  return 'default'
}

export function EventTimeline({ events }: { events: DiagnosticsEventRecord[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No events in this window.</p>
  }

  return (
    <ul className="space-y-2">
      {events.map((ev) => (
        <li key={ev.id} className="rounded-md border border-border bg-card px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={severityTone(ev.severity)}>{ev.severity}</Badge>
            <time className="text-xs text-muted-foreground tabular-nums">
              {new Date(ev.utc).toLocaleString()}
            </time>
            <span className="text-sm font-medium">{ev.name}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {ev.domain}
            {ev.connectionId ? ` · conn ${ev.connectionId.slice(0, 8)}…` : ''}
          </p>
        </li>
      ))}
    </ul>
  )
}
