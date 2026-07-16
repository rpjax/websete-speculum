import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AnalysisPhase } from './types'

const PHASES: AnalysisPhase[] = ['collect', 'correlate', 'narrate', 'render', 'done']

interface AnalysisProgressProps {
  phase: AnalysisPhase
  detail?: string | null
}

export function AnalysisProgress({ phase, detail }: AnalysisProgressProps) {
  if (phase === 'idle') return null
  const idx = PHASES.indexOf(phase === 'error' ? 'collect' : phase)

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap gap-2">
        {PHASES.filter((p) => p !== 'done').map((p, i) => (
          <Badge
            key={p}
            variant={i <= idx ? 'default' : 'muted'}
            className={cn('capitalize', phase === 'error' && i === 0 && 'bg-destructive')}
          >
            {p}
          </Badge>
        ))}
      </div>
      {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}
