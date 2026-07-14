import { cn } from '@/lib/utils'

interface ResourceGaugeProps {
  label: string
  used: number
  total: number
  formatValue?: (n: number) => string
  className?: string
}

export function ResourceGauge({ label, used, total, formatValue, className }: ResourceGaugeProps) {
  const percent = total > 0 ? Math.round((used / total) * 100) : 0
  const fmt = formatValue ?? ((n: number) => String(n))

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {fmt(used)} / {fmt(total)}{' '}
          <span className="text-xs text-muted-foreground">({percent}%)</span>
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            percent > 90 ? 'bg-destructive' : percent > 70 ? 'bg-warning' : 'bg-primary',
          )}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  )
}
