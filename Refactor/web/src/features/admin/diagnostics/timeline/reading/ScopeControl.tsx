import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEffect, useState } from 'react'
import { adminJson } from '@/lib/adminFetch'
import { humanizeConnectionId } from '@/lib/diagnosticsDescriptions'
import type { NarrativeScope } from '../model/narrativeTypes'
import { X } from 'lucide-react'

type LiveSessionRow = {
  sessionId: string
  profileId: string
  connectionOpen: boolean
  uptimeMs: number
}

interface ScopeControlProps {
  scope: NarrativeScope
  onChange: (scope: NarrativeScope) => void
  compact?: boolean
  /** Hide the platform dropdown when there are no live sessions to pick. */
  hideWhenNoChoices?: boolean
}

function shortSessionId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}

export function ScopeControl({ scope, onChange, compact, hideWhenNoChoices }: ScopeControlProps) {
  const [sessions, setSessions] = useState<LiveSessionRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void adminJson<{ items: LiveSessionRow[] }>('/api/sessions')
      .then((r) => setSessions(r.items))
      .catch(() => setSessions([]))
      .finally(() => setLoaded(true))
  }, [])

  if (scope.kind === 'session') {
    const live = sessions.find((s) => s.sessionId === scope.connectionId)
    return (
      <div className="flex shrink-0 items-center gap-1">
        <div
          className={
            compact
              ? 'inline-flex h-7 max-w-[14rem] items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 text-[11px] text-primary'
              : 'inline-flex h-8 max-w-[18rem] items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 text-xs text-primary'
          }
          title={scope.connectionId}
        >
          <span className="truncate font-medium">
            {live ? humanizeConnectionId(scope.connectionId) : `Session ${shortSessionId(scope.connectionId)}`}
            {live?.connectionOpen ? ' · live' : ' · filtered'}
          </span>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 hover:bg-primary/20"
            aria-label="Clear session filter"
            onClick={() => onChange({ kind: 'platform' })}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    )
  }

  if (hideWhenNoChoices && loaded && sessions.length === 0) return null

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Select
        value="platform"
        onValueChange={(v) => {
          if (v === 'platform') onChange({ kind: 'platform' })
          else onChange({ kind: 'session', connectionId: v })
        }}
      >
        <SelectTrigger
          className={compact ? 'h-7 min-w-0 sm:w-[138px] text-[11px]' : 'h-8 min-w-[180px] text-xs'}
          aria-label="Scope"
        >
          {!compact && <span className="mr-1 text-muted-foreground">Scope:</span>}
          <SelectValue placeholder="Scope" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="platform">Whole platform</SelectItem>
          {sessions.map((s) => (
            <SelectItem key={s.sessionId} value={s.sessionId}>
              {humanizeConnectionId(s.sessionId)}
              {s.connectionOpen ? ' · live' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
