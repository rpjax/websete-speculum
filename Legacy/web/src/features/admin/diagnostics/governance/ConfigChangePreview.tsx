import type { ConfigChange } from './diffDiagnosticsConfig'
import { cn } from '@/lib/utils'
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react'

export function ConfigChangePreview({ changes }: { changes: ConfigChange[] }) {
  if (changes.length === 0) return null

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-5">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <h3 className="text-sm font-bold text-warning">Pending changes ({changes.length})</h3>
        <span className="text-xs text-muted-foreground">Save to apply</span>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {changes.map((c) => (
          <div key={c.label} className="flex items-center gap-3 rounded-lg bg-card/50 px-3 py-2">
            <span className="w-44 shrink-0 text-xs font-medium">{c.label}</span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{c.from}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium',
                c.impact === 'up'
                  ? 'bg-success/10 text-success'
                  : c.impact === 'down'
                    ? 'bg-warning/10 text-warning'
                    : 'bg-muted text-foreground',
              )}
            >
              {c.to}
            </span>
            {c.impact === 'up' && <ArrowUpRight className="h-3 w-3 text-success" />}
            {c.impact === 'down' && <ArrowDownRight className="h-3 w-3 text-warning" />}
            {c.impact === 'neutral' && <Minus className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>
    </div>
  )
}
