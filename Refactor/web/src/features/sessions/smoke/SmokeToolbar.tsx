import { ChevronLeft, ChevronRight, Activity, Play, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SmokePhase } from './useSmokeSession'

interface SmokeToolbarProps {
  phase: SmokePhase
  path: string
  currentUrl: string | null
  onPathChange: (path: string) => void
  onStart: () => void
  onStop: () => void
  onStatus: () => void
  onHistory: (direction: 'goback' | 'goforward') => void
}

const PHASE_LABEL: Record<SmokePhase, string> = {
  idle: 'offline',
  connecting: 'connecting hub',
  connected: 'hub connected',
  starting: 'starting session',
  live: 'live',
  stopping: 'stopping',
}

function phaseVariant(phase: SmokePhase): 'success' | 'warning' | 'muted' {
  if (phase === 'live') return 'success'
  if (phase === 'idle') return 'muted'
  return 'warning'
}

export function SmokeToolbar({
  phase,
  path,
  currentUrl,
  onPathChange,
  onStart,
  onStop,
  onStatus,
  onHistory,
}: SmokeToolbarProps) {
  const live = phase === 'live'
  const busy = phase === 'connecting' || phase === 'starting' || phase === 'stopping'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        disabled={!live}
        aria-label="Go back"
        onClick={() => onHistory('goback')}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        disabled={!live}
        aria-label="Go forward"
        onClick={() => onHistory('goforward')}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      <Input
        className="min-w-56 flex-1 font-mono text-xs"
        value={path}
        spellCheck={false}
        aria-label="Start path"
        placeholder="/"
        disabled={live}
        onChange={(event) => onPathChange(event.target.value)}
      />

      {live ? (
        <Button variant="destructive" onClick={onStop} disabled={busy}>
          <Square className="h-4 w-4" /> Stop
        </Button>
      ) : (
        <Button onClick={onStart} disabled={busy}>
          <Play className="h-4 w-4" /> Start session
        </Button>
      )}
      <Button variant="outline" onClick={onStatus} disabled={!live}>
        <Activity className="h-4 w-4" /> Poll status
      </Button>

      <Badge variant={phaseVariant(phase)}>{PHASE_LABEL[phase]}</Badge>
      {currentUrl && (
        <span className="max-w-72 truncate font-mono text-[11px] text-muted-foreground">
          {currentUrl}
        </span>
      )}
    </div>
  )
}
