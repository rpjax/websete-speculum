import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Info } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  icon?: ReactNode
  sub?: ReactNode
  progress?: number
  tooltip?: string
  tone?: 'default' | 'success' | 'warning' | 'destructive'
  className?: string
}

const TONE_ICON_BG: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-400',
  destructive: 'bg-red-500/15 text-red-400',
  default: 'bg-blue-500/15 text-blue-400',
}

export function StatCard({ label, value, icon, sub, progress, tooltip, tone = 'default', className }: StatCardProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-card px-4 py-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {label}
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 shrink-0 text-muted-foreground/50" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">{tooltip}</TooltipContent>
            </Tooltip>
          )}
        </p>
        {icon && (
          <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE_ICON_BG[tone])}>
            {icon}
          </div>
        )}
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      {progress != null && (
        <div className="mt-2">
          <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Usage</span>
            <span className="tabular-nums font-medium">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted/50">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                progress > 90 ? 'bg-red-500' : progress > 70 ? 'bg-amber-500' : 'bg-blue-500',
              )}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
