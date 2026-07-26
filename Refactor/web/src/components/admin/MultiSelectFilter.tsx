import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MultiSelectFilterProps {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (selected: string[]) => void
}

export function MultiSelectFilter({ label, options, selected, onChange }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value])
  }

  const displayLabel = selected.length === 0 ? `${label}: All` : `${label}: ${selected.length}`

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setOpen(!open)}>
        {displayLabel}
        <ChevronDown className="h-3 w-3" />
      </Button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 min-w-[160px] rounded-md border border-border bg-card p-1 shadow-md">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => toggle(opt.value)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-muted"
            >
              <div className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border', selected.includes(opt.value) && 'bg-primary border-primary')}>
                {selected.includes(opt.value) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </div>
              {opt.label}
            </button>
          ))}
          {selected.length > 0 && (
            <button onClick={() => onChange([])} className="mt-1 w-full rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted">
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  )
}
