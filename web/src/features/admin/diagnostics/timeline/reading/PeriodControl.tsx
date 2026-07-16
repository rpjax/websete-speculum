import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarRange } from 'lucide-react'
import type { NarrativePeriod, NarrativePeriodPreset } from '../model/narrativeTypes'

const PRESETS: { value: NarrativePeriodPreset; label: string }[] = [
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
]

function toLocalInput(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

interface PeriodControlProps {
  period: NarrativePeriod
  onChange: (period: NarrativePeriod) => void
  compact?: boolean
}

export function PeriodControl({ period, onChange, compact }: PeriodControlProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Select
        value={period.preset}
        onValueChange={(v) => {
          const preset = v as NarrativePeriodPreset
          if (preset === 'custom') {
            onChange({
              preset,
              fromMs: period.fromMs ?? Date.now() - 3600_000,
              toMs: period.toMs ?? Date.now(),
            })
          } else {
            onChange({ preset, fromMs: null, toMs: null })
          }
        }}
      >
        <SelectTrigger
          className={compact ? 'h-7 w-[88px] text-[11px]' : 'h-8 w-[120px] text-xs'}
          aria-label="Period"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {period.preset === 'custom' && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={compact ? 'h-7 gap-1 px-2 text-[11px]' : 'h-8 gap-1.5 text-xs'}
            >
              <CalendarRange className="h-3.5 w-3.5" />
              {compact ? '…' : 'Range'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-3" align="start">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">From</label>
              <Input
                type="datetime-local"
                className="h-8 text-xs"
                value={toLocalInput(period.fromMs)}
                onChange={(e) => onChange({ ...period, fromMs: fromLocalInput(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">To</label>
              <Input
                type="datetime-local"
                className="h-8 text-xs"
                value={toLocalInput(period.toMs)}
                onChange={(e) => onChange({ ...period, toMs: fromLocalInput(e.target.value) })}
              />
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
