import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type HealthTone = 'success' | 'warning' | 'destructive' | 'muted'

export interface HealthItem {
  id: string
  label: string
  value: string
  tone: HealthTone
  onClick?: () => void
}

const toneVariant: Record<HealthTone, 'success' | 'warning' | 'destructive' | 'muted'> = {
  success: 'success',
  warning: 'warning',
  destructive: 'destructive',
  muted: 'muted',
}

export function HealthStatusStrip({ items, className }: { items: HealthItem[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          disabled={!item.onClick}
          onClick={item.onClick}
          className={cn(
            'inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-sm',
            item.onClick && 'hover:bg-muted cursor-pointer',
            !item.onClick && 'cursor-default',
          )}
        >
          <span className="text-muted-foreground">{item.label}</span>
          <Badge variant={toneVariant[item.tone]}>{item.value}</Badge>
        </button>
      ))}
    </div>
  )
}
