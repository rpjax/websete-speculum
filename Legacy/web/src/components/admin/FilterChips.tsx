import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FilterChip {
  key: string
  label: string
  color?: string
}

interface FilterChipsProps {
  chips: FilterChip[]
  onRemove: (key: string) => void
  onClearAll?: () => void
  className?: string
}

export function FilterChips({ chips, onRemove, onClearAll, className }: FilterChipsProps) {
  if (chips.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="text-[10px] font-medium text-muted-foreground">Active:</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          onClick={() => onRemove(chip.key)}
          className={cn(
            'group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive',
            chip.color ?? 'border-primary/30 bg-primary/10 text-primary',
          )}
        >
          {chip.label}
          <X className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100" />
        </button>
      ))}
      {onClearAll && chips.length > 1 && (
        <button
          onClick={onClearAll}
          className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  )
}

interface ClickableBadgeProps {
  label: string
  active?: boolean
  onClick: () => void
  color?: string
  count?: number
  className?: string
}

export function ClickableBadge({ label, active, onClick, color, count, className }: ClickableBadgeProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all',
        active
          ? 'border-primary/40 bg-primary/15 text-primary ring-1 ring-primary/20'
          : 'border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
        className,
      )}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      {label}
      {count !== undefined && <span className="ml-0.5 font-mono text-[10px] opacity-60">{count}</span>}
    </button>
  )
}
