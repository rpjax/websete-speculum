import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolvePeriodBounds } from '../model/buildNarrative'
import type { NarrativePeriod, NarrativePeriodPreset } from '../model/narrativeTypes'

const QUICK: { value: NarrativePeriodPreset | 'today'; label: string }[] = [
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '2h', label: '2h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: 'today', label: 'Today' },
  { value: 'all', label: 'All' },
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

function startOfLocalDayMs(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function periodButtonLabel(period: NarrativePeriod): string {
  if (period.preset === 'custom') {
    if (period.fromMs != null && period.toMs != null) {
      const a = new Date(period.fromMs).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      const b = new Date(period.toMs).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      return `${a} → ${b}`
    }
    if (period.fromMs != null) {
      return `Since ${new Date(period.fromMs).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    }
    return 'Custom range'
  }
  if (period.preset === 'all') return 'All retained'
  const hit = QUICK.find((q) => q.value === period.preset)
  return hit ? `Last ${hit.label}` : 'Time'
}

function shiftPeriod(period: NarrativePeriod, direction: -1 | 1): NarrativePeriod {
  const { fromMs, toMs } = resolvePeriodBounds(period)
  const span = Math.max(60_000, toMs - fromMs)
  const nextFrom = fromMs + direction * span
  const nextTo = toMs + direction * span
  const now = Date.now()
  // Don't jump the window entirely into the future.
  if (direction > 0 && nextFrom >= now) {
    return { preset: 'custom', fromMs: now - span, toMs: now }
  }
  return {
    preset: 'custom',
    fromMs: nextFrom,
    toMs: Math.min(nextTo, now),
  }
}

interface PeriodControlProps {
  period: NarrativePeriod
  onChange: (period: NarrativePeriod) => void
  compact?: boolean
}

/** Time-range control — button opens a quick picker with shift / custom. */
export function PeriodControl({ period, onChange }: PeriodControlProps) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')

  const applyPreset = (value: NarrativePeriodPreset | 'today') => {
    if (value === 'today') {
      onChange({ preset: 'custom', fromMs: startOfLocalDayMs(), toMs: Date.now() })
    } else if (value === 'custom') {
      onChange({
        preset: 'custom',
        fromMs: period.fromMs ?? Date.now() - 3600_000,
        toMs: period.toMs ?? Date.now(),
      })
    } else {
      onChange({ preset: value, fromMs: null, toMs: null })
    }
    setOpen(false)
  }

  const isToday =
    period.preset === 'custom' &&
    period.fromMs != null &&
    Math.abs(period.fromMs - startOfLocalDayMs()) < 60_000 &&
    period.toMs != null &&
    Date.now() - period.toMs < 120_000

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          const bounds = resolvePeriodBounds(period)
          setDraftFrom(toLocalInput(bounds.fromMs === 0 ? null : bounds.fromMs))
          setDraftTo(toLocalInput(bounds.toMs))
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] font-normal"
          aria-label="Time range"
        >
          <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="max-w-[12rem] truncate">{periodButtonLabel(period)}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] space-y-3 p-3" align="start">
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Last
          </p>
          <div className="grid grid-cols-5 gap-1">
            {QUICK.map((q) => {
              const active = q.value === 'today' ? isToday : period.preset === q.value
              return (
                <button
                  key={q.value}
                  type="button"
                  onClick={() => applyPreset(q.value)}
                  className={cn(
                    'rounded-md border px-1.5 py-1.5 text-center text-[11px] transition-colors',
                    active
                      ? 'border-primary/50 bg-primary/10 font-medium text-primary'
                      : 'border-border text-foreground hover:bg-muted/40',
                  )}
                >
                  {q.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-1 border-t border-border pt-2">
          <button
            type="button"
            className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-border text-[11px] hover:bg-muted/40"
            onClick={() => {
              onChange(shiftPeriod(period, -1))
              setOpen(false)
            }}
            title="Shift window earlier"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Earlier
          </button>
          <button
            type="button"
            className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-border text-[11px] hover:bg-muted/40"
            onClick={() => {
              const { fromMs, toMs } = resolvePeriodBounds(period)
              const span = Math.max(60_000, toMs - fromMs)
              if (period.preset === 'all' || period.preset === 'custom') {
                onChange({ preset: 'custom', fromMs: Date.now() - span, toMs: Date.now() })
              } else {
                // Re-resolve relative preset against now.
                onChange({ preset: period.preset, fromMs: null, toMs: null })
              }
              setOpen(false)
            }}
            title="Snap window to now"
          >
            Now
          </button>
          <button
            type="button"
            className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-border text-[11px] hover:bg-muted/40"
            onClick={() => {
              onChange(shiftPeriod(period, 1))
              setOpen(false)
            }}
            title="Shift window later"
          >
            Later
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-2 border-t border-border pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Custom</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">From</label>
              <Input
                type="datetime-local"
                className="h-8 text-xs"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">To</label>
              <Input
                type="datetime-local"
                className="h-8 text-xs"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 flex-1 text-[11px]"
              onClick={() => {
                setDraftTo(toLocalInput(Date.now()))
              }}
            >
              To = now
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 flex-1 text-[11px]"
              onClick={() => {
                const fromMs = fromLocalInput(draftFrom)
                const toMs = fromLocalInput(draftTo) ?? Date.now()
                if (fromMs == null) return
                onChange({ preset: 'custom', fromMs, toMs })
                setOpen(false)
              }}
            >
              Apply range
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
