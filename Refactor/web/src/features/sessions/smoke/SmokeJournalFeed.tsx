import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { JournalFact } from '@/lib/speculum'
import type { JournalFeed } from './useJournalFeed'

function stamp(publishedAt: string): string {
  const at = Date.parse(publishedAt)
  return Number.isNaN(at) ? publishedAt : new Date(at).toISOString().slice(11, 23)
}

function prettyPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2)
  } catch {
    return payload
  }
}

/** Groups fact types so a burst reads as a shape, not a wall of rows. */
function summarize(facts: JournalFact[]): { type: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const fact of facts) {
    counts.set(fact.type, (counts.get(fact.type) ?? 0) + 1)
  }
  return [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count)
}

function FactRow({ fact }: { fact: JournalFact }) {
  const [open, setOpen] = useState(false)
  const indexKeys = Object.entries(fact.indexKeys)

  return (
    <li className="space-y-1.5 rounded-md border border-border px-2 py-1.5 text-xs">
      <div className="flex items-start gap-2">
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {stamp(fact.publishedAt)}
        </span>
        <span className="min-w-0 flex-1 break-all font-medium">{fact.type}</span>
        <Badge variant={fact.publishPolicy === 'Guaranteed' ? 'default' : 'muted'}>
          {fact.publishPolicy === 'Guaranteed' ? 'guaranteed' : 'best effort'}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="font-mono text-[10px] text-muted-foreground">v{fact.schemaVersion}</span>
        {indexKeys.map(([type, value]) => (
          <span
            key={type}
            className="rounded border border-border px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
            title={value}
          >
            {type}:{value.slice(0, 8)}
          </span>
        ))}
        {fact.payload && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-5 px-1 text-[10px]"
            onClick={() => setOpen((previous) => !previous)}
          >
            {open ? 'hide payload' : 'payload'}
          </Button>
        )}
      </div>

      {open && fact.payload && (
        <pre className="max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-[10px] leading-relaxed">
          {prettyPayload(fact.payload)}
        </pre>
      )}
    </li>
  )
}

/**
 * Live Journal facts admitted by the API, in parallel to the client-side event log.
 * Only catalogued, enabled fact types reach this stream.
 */
export function SmokeJournalFeed({ feed }: { feed: JournalFeed }) {
  const summary = useMemo(() => summarize(feed.facts), [feed.facts])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant={feed.streaming ? 'success' : 'muted'}>
          {feed.streaming ? 'streaming' : 'not streaming'}
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">
          {feed.facts.length} facts · {summary.length} types
        </span>
        {feed.facts.length > 0 && (
          <Button variant="ghost" size="sm" className="ml-auto h-6" onClick={feed.clear}>
            Clear
          </Button>
        )}
      </div>

      {feed.error && (
        <p className="rounded-md border border-destructive/50 p-2 text-xs text-destructive">
          {feed.error}
        </p>
      )}

      {summary.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {summary.map(({ type, count }) => (
            <Badge key={type} variant="muted" className="font-mono text-[10px]">
              {type} ×{count}
            </Badge>
          ))}
        </div>
      )}

      {feed.facts.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
          No Journal facts yet. Connect the hub and act — profile, session and pipe facts
          appear here as the API admits them. Facts admitted before this stream opened are
          not replayed.
        </p>
      ) : (
        <ol className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
          {feed.facts.map((fact) => (
            <FactRow key={fact.id} fact={fact} />
          ))}
        </ol>
      )}
    </div>
  )
}
