import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEffect, useState } from 'react'
import { diagnosticsApi, type MotorSessionListItem } from '@/lib/diagnosticsApi'
import { humanizeConnectionId } from '@/lib/diagnosticsDescriptions'
import type { NarrativeScope } from '../model/narrativeTypes'

interface ScopeControlProps {
  scope: NarrativeScope
  onChange: (scope: NarrativeScope) => void
  compact?: boolean
}

export function ScopeControl({ scope, onChange, compact }: ScopeControlProps) {
  const [sessions, setSessions] = useState<MotorSessionListItem[]>([])

  useEffect(() => {
    void diagnosticsApi.listSessions()
      .then((r) => setSessions(r.sessions))
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
          className={compact ? 'h-7 w-[148px] text-[11px]' : 'h-8 min-w-[180px] text-xs'}
          aria-label="Scope"
        >
          {!compact && <span className="mr-1 text-muted-foreground">Scope:</span>}
          <SelectValue placeholder="Scope" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="platform">Platform (all lanes)</SelectItem>
          {sessions.map((s) => (
            <SelectItem key={s.connectionId} value={s.connectionId}>
              {humanizeConnectionId(s.connectionId)} · {s.phase}
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
