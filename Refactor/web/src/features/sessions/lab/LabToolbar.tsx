import {
  Activity,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Play,
  Square,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import type { LabPhase } from './useLabSession'

interface LabToolbarProps {
  phase: LabPhase
  address: string
  currentUrl: string | null
  onAddressChange: (value: string) => void
  onAddressFocusChange?: (focused: boolean) => void
  onStart: () => void
  onStop: () => void
  onNavigate: () => void
  onStatus: () => void
  onHistory: (direction: 'goback' | 'goforward') => void
}

const PHASE_LABEL: Record<LabPhase, string> = {
  idle: 'offline',
  connecting: 'connecting hub',
  connected: 'hub ready',
  starting: 'starting session',
  live: 'live',
  stopping: 'stopping',
}

function phaseVariant(phase: LabPhase): 'success' | 'warning' | 'muted' {
  if (phase === 'live') return 'success'
  if (phase === 'idle') return 'muted'
  return 'warning'
}

/**
 * Lab chrome for session lifecycle + runtime navigation.
 * Address bar: idle → start path; live → NavigateAsync (Enter / Go).
 */
export function LabToolbar({
  phase,
  address,
  currentUrl,
  onAddressChange,
  onAddressFocusChange,
  onStart,
  onStop,
  onNavigate,
  onStatus,
  onHistory,
}: LabToolbarProps) {
  const live = phase === 'live'
  const busy = phase === 'connecting' || phase === 'starting' || phase === 'stopping'

  const submitAddress = () => {
    if (live) {
      onNavigate()
    } else if (!busy) {
      onStart()
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
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
        </div>

        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            submitAddress()
          }}
        >
          <Input
            className="min-w-0 flex-1 font-mono text-xs"
            value={address}
            spellCheck={false}
            aria-label={live ? 'Navigate URL' : 'Start URL'}
            placeholder={live ? 'google.com or https://…' : 'google.com or /path'}
            disabled={busy}
            onChange={(event) => onAddressChange(event.target.value)}
            onFocus={() => onAddressFocusChange?.(true)}
            onBlur={() => onAddressFocusChange?.(false)}
          />
          {live ? (
            <Button type="submit" variant="outline" disabled={busy}>
              <CornerDownLeft className="h-4 w-4" /> Go
            </Button>
          ) : (
            <Button type="submit" disabled={busy}>
              <Play className="h-4 w-4" /> Start
            </Button>
          )}
        </form>

        {live && (
          <Button variant="destructive" onClick={onStop} disabled={busy}>
            <Square className="h-4 w-4" /> Stop
          </Button>
        )}

        <Button variant="outline" onClick={onStatus} disabled={!live} title="Pull unary SessionStatus">
          <Activity className="h-4 w-4" /> Status
        </Button>

        <Badge variant={phaseVariant(phase)}>{PHASE_LABEL[phase]}</Badge>
      </div>

      {live && currentUrl && (
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0 uppercase tracking-wide">Browser</span>
          <Separator orientation="vertical" className="h-3" />
          <span className="min-w-0 truncate font-mono" title={currentUrl}>
            {currentUrl}
          </span>
        </p>
      )}
    </div>
  )
}
