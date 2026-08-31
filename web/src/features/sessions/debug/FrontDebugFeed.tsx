import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  exportFrontDebugJsonl,
  type FrontDebugLogEntry,
  type FrontDebugLogLevel,
} from './frontDebugLog'

const LEVEL_VARIANT: Record<
  FrontDebugLogLevel,
  'default' | 'success' | 'warning' | 'destructive' | 'muted'
> = {
  info: 'default',
  wire: 'muted',
  warn: 'warning',
  error: 'destructive',
}

function stamp(at: number): string {
  return new Date(at).toISOString().slice(11, 23)
}

export interface FrontDebugFeedProps {
  entries: FrontDebugLogEntry[]
  /** When observation master is off — explain how to enable. */
  observationEnabled?: boolean
  emptyHint?: string
  className?: string
}

/**
 * Shared Activity / observation feed — Lab Debug dock and Live observation chrome.
 */
export function FrontDebugFeed({
  entries,
  observationEnabled = true,
  emptyHint,
  className,
}: FrontDebugFeedProps) {
  if (!observationEnabled) {
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
        Front observation is off. Enable{' '}
        <code className="text-foreground">Telemetry.ClientObservation</code> in Admin (or Lab
        Config → Telemetry), Apply, then refresh.
      </p>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
        {emptyHint ??
          'No front observation entries yet. Start a session and enable plane toggles (video input / PageProjection Frame / Intent).'}
      </p>
    )
  }

  return (
    <div className={className}>
      <div className="mb-2 flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const blob = new Blob([exportFrontDebugJsonl(entries)], {
              type: 'application/x-ndjson',
            })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `speculum-front-debug-${Date.now()}.jsonl`
            a.click()
            URL.revokeObjectURL(url)
          }}
        >
          Export JSONL
        </Button>
      </div>
      <ol className="space-y-1 pr-1">
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
            {entry.fields?.plane ? (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/90">
                {entry.fields.plane}
                {entry.fields.hop ? `·${entry.fields.hop}` : ''}
              </span>
            ) : null}
            {entry.detail && (
              <span className="min-w-0 break-all font-mono text-[11px] text-muted-foreground">
                {entry.detail}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
