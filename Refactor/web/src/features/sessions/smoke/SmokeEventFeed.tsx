import { Badge } from '@/components/ui/badge'
import type { SmokeLogEntry, SmokeLogLevel } from './smokeLog'

const LEVEL_VARIANT: Record<SmokeLogLevel, 'default' | 'success' | 'warning' | 'destructive' | 'muted'> = {
  info: 'default',
  wire: 'muted',
  warn: 'warning',
  error: 'destructive',
}

function stamp(at: number): string {
  return new Date(at).toISOString().slice(11, 23)
}

export function SmokeEventFeed({ entries }: { entries: SmokeLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
        No wire events yet. Start a session to see hub, notification, console and error traffic.
      </p>
    )
  }

  return (
    <ol className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
        >
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {stamp(entry.at)}
          </span>
          <Badge variant={LEVEL_VARIANT[entry.level]} className="shrink-0">
            {entry.label}
          </Badge>
          {entry.detail && (
            <span className="min-w-0 break-all font-mono text-[11px] text-muted-foreground">
              {entry.detail}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}
