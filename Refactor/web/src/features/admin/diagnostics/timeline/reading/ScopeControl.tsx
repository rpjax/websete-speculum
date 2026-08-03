import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEffect, useState } from 'react'
import { adminJson } from '@/lib/adminFetch'
import { humanizeConnectionId } from '@/lib/diagnosticsDescriptions'
import type { NarrativeScope } from '../model/narrativeTypes'

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
}

export function ScopeControl({ scope, onChange, compact }: ScopeControlProps) {
  const [sessions, setSessions] = useState<LiveSessionRow[]>([])

  useEffect(() => {
    void adminJson<{ items: LiveSessionRow[] }>('/api/sessions')
      .then((r) => setSessions(r.items))
      .catch(() => setSessions([]))
  }, [])

  const value = scope.kind === 'platform' ? 'platform' : scope.connectionId

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === 'platform') onChange({ kind: 'platform' })
          else onChange({ kind: 'session', connectionId: v })
        }}
      >
        <SelectTrigger
          className={compact ? 'h-7 min-w-0 flex-1 sm:w-[148px] sm:flex-none text-[11px]' : 'h-8 min-w-[180px] text-xs'}
          aria-label="Scope"
        >
          {!compact && <span className="mr-1 text-muted-foreground">Scope:</span>}
          <SelectValue placeholder="Scope" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="platform">Platform (all lanes)</SelectItem>
          {sessions.map((s) => (
            <SelectItem key={s.sessionId} value={s.sessionId}>
              {humanizeConnectionId(s.sessionId)}
              {s.connectionOpen ? ' · live' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {scope.kind === 'session' && (
        <Button
          variant="ghost"
          size="sm"
          className={compact ? 'h-7 px-1.5 text-[11px]' : 'h-8 text-xs'}
          onClick={() => onChange({ kind: 'platform' })}
        >
          Clear
        </Button>
      )}
    </div>
  )
}
