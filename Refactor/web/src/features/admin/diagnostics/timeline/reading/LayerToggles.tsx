import { cn } from '@/lib/utils'
import type { NarrativeLayers } from '../model/narrativeTypes'

const TOGGLES: { key: keyof NarrativeLayers; label: string }[] = [
  { key: 'systemLane', label: 'System' },
  { key: 'beatRibbon', label: 'Beats' },
  { key: 'governanceBands', label: 'Governance' },
  { key: 'signalOverlay', label: 'Signals' },
  { key: 'liveTail', label: 'Live' },
]

interface LayerTogglesProps {
  layers: NarrativeLayers
  onChange: (layers: NarrativeLayers) => void
}

export function LayerToggles({ layers, onChange }: LayerTogglesProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {TOGGLES.map((t) => {
        const on = layers[t.key]
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={on}
            aria-label={`${t.label} layer`}
            onClick={() => onChange({ ...layers, [t.key]: !on })}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              on
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
