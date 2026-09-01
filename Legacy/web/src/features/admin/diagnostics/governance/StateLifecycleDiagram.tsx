import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ArrowRight, ShieldAlert, ShieldCheck, Zap } from 'lucide-react'

export function StateLifecycleDiagram({ current }: { current: string }) {
  const states: {
    name: string
    icon: typeof ShieldCheck
    description: string
    detail: string
  }[] = [
    {
      name: 'Normal',
      icon: ShieldCheck,
      description: 'Configured toggles active',
      detail: 'Full diagnostics capability — all configured toggles are in effect.',
    },
    {
      name: 'Elevated',
      icon: Zap,
      description: 'Browser Query unlocked',
      detail: 'Temporary deep inspection — Probe + Sidecar events forced on (TTL overlay).',
    },
    {
      name: 'Degraded',
      icon: ShieldAlert,
      description: 'Circuit breaker tripped',
      detail: 'Capped at Metric due to sink pressure — Recover clears this; PUT config does not.',
    },
  ]

  return (
    <div className="rounded-lg border border-border bg-muted/10 p-4">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        State lifecycle
      </p>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Runtime overlays sit on top of saved config. Elevate unlocks probes; Degraded caps everything to Metric until Recover.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {states.map((state, i) => {
          const isActive = state.name === current
          const Icon = state.icon
          return (
            <div key={state.name} className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 transition-all',
                      isActive
                        ? state.name === 'Degraded'
                          ? 'border-destructive/40 bg-destructive/10 ring-2 ring-destructive/20'
                          : state.name === 'Elevated'
                            ? 'border-primary/40 bg-primary/10 ring-2 ring-primary/20'
                            : 'border-success/40 bg-success/10 ring-2 ring-success/20'
                        : 'border-border bg-card',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4',
                        isActive
                          ? state.name === 'Degraded'
                            ? 'text-destructive'
                            : state.name === 'Elevated'
                              ? 'text-primary'
                              : 'text-success'
                          : 'text-muted-foreground',
                      )}
                    />
                    <div>
                      <p className={cn('text-xs font-bold', isActive ? '' : 'text-muted-foreground')}>
                        {state.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{state.description}</p>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">{state.detail}</TooltipContent>
              </Tooltip>
              {i < states.length - 1 && (
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
