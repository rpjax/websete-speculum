import { cn } from '@/lib/utils'
import { SEVERITY_BG } from '@/lib/diagnosticsConstants'

interface SeverityBadgeProps {
  severity: string
  className?: string
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const bg = SEVERITY_BG[severity] ?? 'bg-muted text-muted-foreground border-border'
  return (
    <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium', bg, className)}>
      {severity}
    </span>
  )
}
