import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function StatCard({
  label,
  value,
  icon,
  sub,
  progress,
  tone = 'default',
  className,
}: {
  label: string
  value: string | number
  icon?: ReactNode
  sub?: ReactNode
  progress?: number
  tone?: 'default' | 'success' | 'warning' | 'destructive'
  className?: string
}) {
  const iconTone = {
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    destructive: 'bg-destructive/15 text-destructive',
    default: 'bg-primary/15 text-primary',
  }[tone]

  return (
    <div className={cn('rounded-lg border border-border bg-card px-4 py-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon ? (
          <div className={cn('grid h-8 w-8 place-items-center rounded-lg', iconTone)}>{icon}</div>
        ) : null}
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
      {progress != null ? (
        <div className="mt-2 h-1.5 w-full rounded-full bg-muted/50">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              progress > 90 ? 'bg-destructive' : progress > 70 ? 'bg-warning' : 'bg-primary',
            )}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}
