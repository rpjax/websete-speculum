import { Bug, PanelBottomClose } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FrontDebugFeed } from '@/features/sessions/debug/FrontDebugFeed'
import type {
  ClientObservationConfig,
  FrontDebugLogEntry,
} from '@/features/sessions/debug/frontDebugLog'
import { cn } from '@/lib/utils'

export interface SessionObservationChromeProps {
  entries: FrontDebugLogEntry[]
  observation: ClientObservationConfig
  /** Lab embeds Activity inside Debug dock — Live uses floating reveal. */
  presentation: 'lab-embed' | 'live-float'
  className?: string
}

/**
 * Shared front observation chrome for Lab + Live (composition root for Activity).
 * Enablement: Telemetry.ClientObservation via public client-config.
 */
export function SessionObservationChrome({
  entries,
  observation,
  presentation,
  className,
}: SessionObservationChromeProps) {
  const [open, setOpen] = useState(false)

  if (presentation === 'lab-embed') {
    return (
      <FrontDebugFeed
        entries={entries}
        observationEnabled={observation.isEnabled}
        className={className}
      />
    )
  }

  if (!observation.isEnabled) {
    return null
  }

  return (
    <div className={cn('pointer-events-none fixed bottom-3 right-3 z-40 flex flex-col items-end gap-2', className)}>
      {open ? (
        <aside className="pointer-events-auto flex max-h-[min(50vh,28rem)] w-[min(100vw-1.5rem,28rem)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">Front observation</p>
              <p className="text-[11px] text-muted-foreground">
                Same ring as Lab Activity — export JSONL to correlate with Journal.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={() => setOpen(false)}
              aria-label="Hide observation"
            >
              <PanelBottomClose className="h-3.5 w-3.5" />
              Hide
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <FrontDebugFeed entries={entries} observationEnabled />
          </div>
        </aside>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="pointer-events-auto gap-1.5 shadow-md"
          onClick={() => setOpen(true)}
          aria-label="Show front observation"
        >
          <Bug className="h-3.5 w-3.5" />
          Observe
          {entries.length > 0 ? (
            <span className="font-mono text-[10px] text-muted-foreground">{entries.length}</span>
          ) : null}
        </Button>
      )}
    </div>
  )
}
