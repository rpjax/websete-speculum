import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ResourceGauge } from '@/components/admin/ResourceGauge'
import type { DiagnosticsOptions } from '@/lib/diagnosticsApi'
import { formatBytes, formatDuration } from '@/lib/diagnosticsConstants'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  Clock,
  Cpu,
  HardDrive,
  HelpCircle,
  Info,
  List,
  ShieldAlert,
  Timer,
  Zap,
} from 'lucide-react'

interface GovernanceBudgetsTabProps {
  config: DiagnosticsOptions
  onChange: (next: DiagnosticsOptions) => void
  bytesUsed?: number
}

type SizeUnit = 'MB' | 'GB'
type TtlUnit = 'hours' | 'days' | 'months' | 'years'

const MIB = 1024 * 1024
const GIB = 1024 * MIB
const HOURS_PER_DAY = 24
const HOURS_PER_MONTH = 30 * HOURS_PER_DAY
const HOURS_PER_YEAR = 365 * HOURS_PER_DAY

const STORAGE_PRESETS = [
  { bytes: 8 * GIB, label: '8 GB', hint: 'Lean host' },
  { bytes: 16 * GIB, label: '16 GB', hint: 'Production / Dev default' },
  { bytes: 24 * GIB, label: '24 GB', hint: 'Busy fleet' },
  { bytes: 32 * GIB, label: '32 GB', hint: 'Assertive default' },
  { bytes: 40 * GIB, label: '40 GB', hint: 'Heavy retention' },
  { bytes: 48 * GIB, label: '48 GB', hint: 'Near full 50 GB disk' },
] as const

const TTL_PRESETS = [
  { hours: 7 * HOURS_PER_DAY, label: '7 days' },
  { hours: 14 * HOURS_PER_DAY, label: '14 days' },
  { hours: 30 * HOURS_PER_DAY, label: '30 days' },
  { hours: 60 * HOURS_PER_DAY, label: '60 days' },
  { hours: 90 * HOURS_PER_DAY, label: '90 days' },
  { hours: HOURS_PER_YEAR, label: '1 year' },
] as const

function preferSizeUnit(bytes: number): SizeUnit {
  return bytes >= GIB ? 'GB' : 'MB'
}

function preferTtlUnit(hours: number): TtlUnit {
  if (hours >= HOURS_PER_YEAR && hours % HOURS_PER_YEAR === 0) return 'years'
  if (hours >= HOURS_PER_MONTH && hours % HOURS_PER_MONTH === 0) return 'months'
  if (hours >= HOURS_PER_DAY && hours % HOURS_PER_DAY === 0) return 'days'
  if (hours >= HOURS_PER_YEAR) return 'years'
  if (hours >= HOURS_PER_MONTH) return 'months'
  if (hours >= HOURS_PER_DAY) return 'days'
  return 'hours'
}

function bytesToUnit(bytes: number, unit: SizeUnit): number {
  const raw = unit === 'GB' ? bytes / GIB : bytes / MIB
  return Math.round(raw * 100) / 100
}

function unitToBytes(value: number, unit: SizeUnit): number {
  const n = Math.max(unit === 'GB' ? 0.001 : 1, value)
  return Math.max(1024, Math.round(n * (unit === 'GB' ? GIB : MIB)))
}

function hoursToUnit(hours: number, unit: TtlUnit): number {
  const div =
    unit === 'years'
      ? HOURS_PER_YEAR
      : unit === 'months'
        ? HOURS_PER_MONTH
        : unit === 'days'
          ? HOURS_PER_DAY
          : 1
  return Math.round((hours / div) * 100) / 100
}

function unitToHours(value: number, unit: TtlUnit): number {
  const n = Math.max(0.01, value)
  const mul =
    unit === 'years'
      ? HOURS_PER_YEAR
      : unit === 'months'
        ? HOURS_PER_MONTH
        : unit === 'days'
          ? HOURS_PER_DAY
          : 1
  return Math.max(1, Math.round(n * mul))
}

function formatTtlHuman(hours: number): string {
  if (hours >= HOURS_PER_YEAR && hours % HOURS_PER_YEAR === 0) {
    const y = hours / HOURS_PER_YEAR
    return `${y} year${y === 1 ? '' : 's'}`
  }
  if (hours >= HOURS_PER_MONTH) {
    const mo = Math.round((hours / HOURS_PER_MONTH) * 10) / 10
    if (Number.isInteger(mo) || hours % HOURS_PER_MONTH === 0) {
      const m = hours / HOURS_PER_MONTH
      return `${m} month${m === 1 ? '' : 's'}`
    }
  }
  if (hours >= HOURS_PER_DAY && hours % HOURS_PER_DAY === 0) {
    const d = hours / HOURS_PER_DAY
    return `${d} day${d === 1 ? '' : 's'}`
  }
  if (hours >= HOURS_PER_DAY) {
    const d = Math.round((hours / HOURS_PER_DAY) * 10) / 10
    return `~${d} days`
  }
  return formatDuration(hours * 3_600_000)
}

export function GovernanceBudgetsTab({ config, onChange, bytesUsed = 0 }: GovernanceBudgetsTabProps) {
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>(() => preferSizeUnit(config.storage.maxBytes))
  const [ttlUnit, setTtlUnit] = useState<TtlUnit>(() => preferTtlUnit(config.storage.ttlHours))

  useEffect(() => {
    setSizeUnit(preferSizeUnit(config.storage.maxBytes))
  }, [config.storage.maxBytes])

  useEffect(() => {
    setTtlUnit(preferTtlUnit(config.storage.ttlHours))
  }, [config.storage.ttlHours])

  const underCurrent = config.storage.maxBytes < bytesUsed
  const usedPct =
    config.storage.maxBytes > 0 ? Math.round((bytesUsed / config.storage.maxBytes) * 100) : 0
  const headroom = Math.max(0, config.storage.maxBytes - bytesUsed)
  const sizeDisplay = bytesToUnit(config.storage.maxBytes, sizeUnit)
  const ttlDisplay = hoursToUnit(config.storage.ttlHours, ttlUnit)

  function setStorage(patch: Partial<DiagnosticsOptions['storage']>) {
    onChange({ ...config, storage: { ...config.storage, ...patch } })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 sm:px-5">
        <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 text-sm leading-relaxed">
          <p className="font-medium">How much diagnostics may keep — and how hard probes may push</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Storage limits protect the host when the event store fills. Sampling trims noisy mirrors only —
            catalog Act→Assert beats are never randomly dropped. Probe limits cap Browser Query work when
            Elevate unlocks deep inspection.
          </p>
        </div>
      </div>

      {/* Storage — primary */}
      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-start gap-3 border-b border-border/50 px-4 py-3.5 sm:px-5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <HardDrive className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Event store size</h3>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
              Cap how much persisted diagnostic history stays on disk/memory. When full, overflow policy
              prunes and emits <code className="rounded bg-muted px-1">Diagnostics.StorageOverflow</code>.
            </p>
          </div>
        </header>

        <div className="space-y-5 p-4 sm:p-5">
          <div className="rounded-lg border border-border/60 bg-muted/10 p-4">
            <ResourceGauge
              label="Live usage vs draft limit"
              used={bytesUsed}
              total={Math.max(config.storage.maxBytes, 1)}
              formatValue={formatBytes}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {usedPct < 50 && (
                <>
                  Comfortable headroom — about{' '}
                  <span className="font-medium text-foreground">{formatBytes(headroom)}</span> free before
                  overflow.
                </>
              )}
              {usedPct >= 50 && usedPct < 80 && (
                <>
                  Moderate pressure ({usedPct}%). Consider raising the limit or shortening TTL if you need
                  longer Timeline windows.
                </>
              )}
              {usedPct >= 80 && !underCurrent && (
                <>
                  High pressure ({usedPct}%). Overflow is likely soon — raise the limit or expect{' '}
                  <code className="rounded bg-muted px-1">DropOldest</code> pruning.
                </>
              )}
              {underCurrent && (
                <span className="text-warning">
                  Draft limit is below current usage — saving will force immediate pruning.
                </span>
              )}
            </p>
          </div>

          {underCurrent && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <p className="text-xs text-warning leading-relaxed">
                Draft max ({formatBytes(config.storage.maxBytes)}) is below live usage (
                {formatBytes(bytesUsed)}). Save will trigger overflow cleanup.
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Quick size presets
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STORAGE_PRESETS.map((p) => {
                const selected = Math.abs(config.storage.maxBytes - p.bytes) < MIB / 2
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setSizeUnit(preferSizeUnit(p.bytes))
                      setStorage({ maxBytes: p.bytes })
                    }}
                    className={cn(
                      'rounded-lg border px-3 py-2.5 text-left transition-colors',
                      selected
                        ? 'border-primary/50 bg-primary/10 ring-2 ring-primary/20'
                        : 'border-border bg-muted/10 hover:bg-muted/20',
                    )}
                  >
                    <p className="text-sm font-bold">{p.label}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{p.hint}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldCard
              icon={<HardDrive className="h-3.5 w-3.5" />}
              title="Maximum store size"
              body="Total budget for persisted diagnostic events. Use MB for small hosts or GB for long retention."
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min={sizeUnit === 'GB' ? 0.01 : 1}
                  step={sizeUnit === 'GB' ? 0.25 : 1}
                  value={sizeDisplay}
                  onChange={(e) =>
                    setStorage({ maxBytes: unitToBytes(Number(e.target.value) || 0, sizeUnit) })
                  }
                  className="h-9 w-28 text-sm"
                />
                <Select
                  value={sizeUnit}
                  onValueChange={(u) => setSizeUnit(u as SizeUnit)}
                >
                  <SelectTrigger className="h-9 w-[4.5rem] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MB">MB</SelectItem>
                    <SelectItem value="GB">GB</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  = {formatBytes(config.storage.maxBytes)}
                </span>
              </div>
            </FieldCard>

            <FieldCard
              icon={<List className="h-3.5 w-3.5" />}
              title="Events per session"
              body="Cap history for a single live connection. Oldest beats for that session prune first when exceeded."
            >
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={config.storage.maxEventsPerSession}
                  onChange={(e) =>
                    setStorage({ maxEventsPerSession: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="h-9 w-28 text-sm"
                />
                <span className="text-xs text-muted-foreground">
                  {config.storage.maxEventsPerSession.toLocaleString()} events
                </span>
              </div>
            </FieldCard>

            <FieldCard
              icon={<Clock className="h-3.5 w-3.5" />}
              title="Retention (TTL)"
              body="Age after which events are cleaned even if the store is not full. Months use 30-day calendar; years use 365 days."
            >
              <div className="mb-2 flex flex-wrap gap-1.5">
                {TTL_PRESETS.map((p) => (
                  <button
                    key={p.hours}
                    type="button"
                    onClick={() => {
                      setTtlUnit(preferTtlUnit(p.hours))
                      setStorage({ ttlHours: p.hours })
                    }}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                      config.storage.ttlHours === p.hours
                        ? 'border-primary/40 bg-primary/15 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted/30',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min={ttlUnit === 'hours' ? 1 : 0.01}
                  step={ttlUnit === 'hours' ? 1 : 0.25}
                  value={ttlDisplay}
                  onChange={(e) =>
                    setStorage({ ttlHours: unitToHours(Number(e.target.value) || 0, ttlUnit) })
                  }
                  className="h-9 w-24 text-sm"
                />
                <Select value={ttlUnit} onValueChange={(u) => setTtlUnit(u as TtlUnit)}>
                  <SelectTrigger className="h-9 w-[6.5rem] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                    <SelectItem value="months">Months</SelectItem>
                    <SelectItem value="years">Years</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  ≈ {formatTtlHuman(config.storage.ttlHours)} ({config.storage.ttlHours.toLocaleString()}h)
                </span>
              </div>
            </FieldCard>

            <FieldCard
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
              title="When the store is full"
              body="Only DropOldest is available in V1 — remove the oldest events to make room and record StorageOverflow."
            >
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                <p className="text-sm font-medium">{config.storage.overflow}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
                  Oldest events go first. Timeline windows shrink from the past, not the present.
                </p>
              </div>
            </FieldCard>
          </div>
        </div>
      </section>

      {/* Sampling */}
      <Accordion type="multiple" defaultValue={['sampling']}>
        <AccordionItem value="sampling" className="rounded-xl border border-border bg-card">
          <AccordionTrigger className="px-4 py-3.5 hover:no-underline sm:px-5">
            <div className="flex items-start gap-3 text-left">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Timer className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-bold">Noise sampling</p>
                <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                  Throttle high-volume mirrors — never catalog lifecycle / probe / navigate beats
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 border-t border-border/50 px-4 pb-5 pt-4 sm:px-5">
            <Callout>
              Ratios only affect noisy streams such as <code>Motor.StatusMirrored</code>. MotorAssert
              Act→Assert events stay at full fidelity regardless of these knobs.
            </Callout>
            <div className="grid gap-3 sm:grid-cols-2">
              <RatioField
                title="Status mirror keep rate"
                body="Fraction of periodic status snapshots kept (FPS, queues). Lower = quieter store."
                value={config.sampling.statusMirrorRatio}
                onChange={(v) =>
                  onChange({ ...config, sampling: { ...config.sampling, statusMirrorRatio: v } })
                }
                left="Drop all"
                right="Keep all"
              />
              <RatioField
                title="Expensive event keep rate"
                body="Fraction of costly high-volume events kept. Use lower values under storage pressure."
                value={config.sampling.expensiveEventRatio}
                onChange={(v) =>
                  onChange({ ...config, sampling: { ...config.sampling, expensiveEventRatio: v } })
                }
                left="Minimal"
                right="Full"
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="probes" className="mt-4 rounded-xl border border-border bg-card">
          <AccordionTrigger className="px-4 py-3.5 hover:no-underline sm:px-5">
            <div className="flex items-start gap-3 text-left">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Cpu className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-bold">Browser Query & Elevate limits</p>
                <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                  Guardrails when probes run (especially during Elevate)
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 border-t border-border/50 px-4 pb-5 pt-4 sm:px-5">
            <Callout>
              These do not enable probes by themselves. Coverage (or Elevate) must unlock Browser Query;
              these knobs only bound how hard that work may push.
            </Callout>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldCard
                icon={<Zap className="h-3.5 w-3.5" />}
                title="Elevate ceiling"
                body="Longest Elevate duration an operator may request from the command bar."
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={config.elevate.browserQueryMaxMinutes}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        elevate: {
                          browserQueryMaxMinutes: clamp(Number(e.target.value) || 1, 1, 1440),
                        },
                      })
                    }
                    className="h-9 w-24 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">minutes (1–1440)</span>
                </div>
              </FieldCard>

              <FieldCard
                icon={<Cpu className="h-3.5 w-3.5" />}
                title="Concurrent probes / session"
                body="How many Browser Query ops may run at once on one connection. Excess returns probe_busy."
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={32}
                    value={config.probe.maxConcurrentProbesPerSession}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        probe: {
                          ...config.probe,
                          maxConcurrentProbesPerSession: clamp(Number(e.target.value) || 1, 1, 32),
                        },
                      })
                    }
                    className="h-9 w-24 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">at a time</span>
                </div>
              </FieldCard>

              <FieldCard
                icon={<HardDrive className="h-3.5 w-3.5" />}
                title="Max probe response"
                body="Hard cap on a single probe payload (DOM, cookies, evaluate). Oversized answers return response_too_large."
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    step={64}
                    value={Math.round(config.probe.maxProbeResponseBytes / 1024)}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        probe: {
                          ...config.probe,
                          maxProbeResponseBytes: Math.max(1024, (Number(e.target.value) || 1) * 1024),
                        },
                      })
                    }
                    className="h-9 w-28 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    KB ({formatBytes(config.probe.maxProbeResponseBytes)})
                  </span>
                </div>
              </FieldCard>

              <FieldCard
                icon={<Timer className="h-3.5 w-3.5" />}
                title="Probe timeout"
                body="How long a browser probe may run before probe_timeout. Raise on heavy pages; lower to fail fast."
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={100}
                    step={500}
                    value={config.probe.diagTimeoutMs}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        probe: {
                          ...config.probe,
                          diagTimeoutMs: Math.max(100, Number(e.target.value) || 100),
                        },
                      })
                    }
                    className="h-9 w-28 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    ms · {formatDuration(config.probe.diagTimeoutMs)}
                  </span>
                </div>
              </FieldCard>

              <FieldCard
                icon={<Clock className="h-3.5 w-3.5" />}
                title="Host sample interval"
                body="Minimum gap between host CPU/memory samples reused by the Telemetry sampler."
                className="sm:col-span-2"
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={100}
                    step={100}
                    value={config.probe.hostSampleIntervalMs}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        probe: {
                          ...config.probe,
                          hostSampleIntervalMs: Math.max(100, Number(e.target.value) || 100),
                        },
                      })
                    }
                    className="h-9 w-28 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    ms between host samples
                  </span>
                </div>
              </FieldCard>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

function FieldCard({
  icon,
  title,
  body,
  children,
  className,
}: {
  icon: ReactNode
  title: string
  body: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col rounded-lg border border-border/60 bg-muted/10 p-3.5', className)}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <p className="text-sm font-medium">{title}</p>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-auto">{children}</div>
    </div>
  )
}

function RatioField({
  title,
  body,
  value,
  onChange,
  left,
  right,
}: {
  title: string
  body: string
  value: number
  onChange: (v: number) => void
  left: string
  right: string
}) {
  const pct = Math.round(clamp(value, 0, 1) * 100)
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3.5">
      <div className="mb-1 flex items-center gap-1.5">
        <p className="text-sm font-medium">{title}</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{body}</TooltipContent>
        </Tooltip>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">{body}</p>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={clamp(value, 0, 1)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-primary"
      />
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{left}</span>
        <span className="font-semibold tabular-nums text-foreground">{pct}%</span>
        <span>{right}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Label className="text-[11px] text-muted-foreground">Exact</Label>
        <Input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value) || 0, 0, 1))}
          className="h-8 w-20 text-xs"
        />
      </div>
    </div>
  )
}
