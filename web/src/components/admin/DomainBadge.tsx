import { cn } from '@/lib/utils'
import { DOMAIN_BG, DOMAIN_LABELS, DOMAIN_DESCRIPTIONS } from '@/lib/diagnosticsConstants'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface DomainBadgeProps {
  domain: string
  className?: string
  showTooltip?: boolean
}

export function DomainBadge({ domain, className, showTooltip = true }: DomainBadgeProps) {
  const label = DOMAIN_LABELS[domain] ?? domain
  const bg = DOMAIN_BG[domain] ?? 'bg-muted text-muted-foreground border-border'
  const description = DOMAIN_DESCRIPTIONS[domain]

  const badge = (
    <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium', bg, className)}>
      {label}
    </span>
  )

  if (!showTooltip || !description) return badge

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {description}
      </TooltipContent>
    </Tooltip>
  )
}
