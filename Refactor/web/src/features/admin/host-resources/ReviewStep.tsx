import { ArrowRight, Check, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  DataCard,
  HelperCallout,
  StatusPill,
} from '@/features/admin/components'
import {
  formatCompactCount,
  formatGibLabel,
  planBreakdownPercents,
  type HostResourceProvisionPlan,
  type HostResourceStatus,
} from './hostResourcesHelpers'

export function ReviewStep({
  plan,
  status,
  onBack,
  onApply,
  pending,
}: {
  plan: HostResourceProvisionPlan
  status: HostResourceStatus | null
  onBack: () => void
  onApply: () => void
  pending: boolean
}) {
  const breakdown = planBreakdownPercents(plan)
  const remainderBytes = Math.max(0, plan.budgetBytes - plan.reserveBytes - plan.shmTargetBytes)
  const hostTotal = plan.hostMemoryTotalBytes
  const nowShm = status?.sidecar?.shmSizeBytes ?? null
  const nowNofile = status?.sidecar?.nofile ?? null
  const nowNproc = status?.sidecar?.nproc ?? null
  const last = status?.lastApply ?? null

  const comparisons: CompareRow[] = [
    {
      label: 'Shared memory (/dev/shm)',
      hint: 'What browser sessions actually get after apply',
      before: nowShm,
      after: plan.shmTargetBytes,
      emphasize: true,
    },
    {
      label: 'Planning budget',
      hint: 'How much host RAM Speculum plans against (not free RAM)',
      before: last?.budgetBytes ?? null,
      after: plan.budgetBytes,
    },
    {
      label: 'Kept for the OS',
      hint: 'Taken from the budget first so the host keeps headroom',
      before: last?.reserveBytes ?? null,
      after: plan.reserveBytes,
    },
  ]

  return (
    <div className="space-y-5">
      <HelperCallout tone="warning" title="Apply changes sidecar capacity for new sessions">
        Existing live sessions are not resized by this apply. After apply, refresh status before admitting more load.
      </HelperCallout>

      <DataCard className="space-y-4 p-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">How this budget works</p>
          <p className="text-xs text-muted-foreground">
            Numbers come from the <span className="font-medium text-foreground">host RAM total</span> (
            {formatGibLabel(hostTotal)}), not from free RAM right now.
          </p>
        </div>
        <ol className="space-y-2 text-xs text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-mono text-[10px] text-primary">1</span>
            <span>
              <span className="font-medium text-foreground">Budget</span> — how much of the host Speculum may plan
              against ({formatGibLabel(plan.budgetBytes)}
              {plan.budgetBytes + GIB_EPS < hostTotal
                ? `, capped below the full ${formatGibLabel(hostTotal)}`
                : ', the full host'}
              ).
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-[10px] text-warning">2</span>
            <span>
              <span className="font-medium text-foreground">Reserve</span> — taken first for the OS and other apps (
              {formatGibLabel(plan.reserveBytes)}).
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-[10px] text-success">3</span>
            <span>
              <span className="font-medium text-foreground">Shared memory</span> — everything left after the OS
              reserve (unless you set a lower percent ceiling), applied to sidecar{' '}
              <span className="font-mono">/dev/shm</span> ({formatGibLabel(plan.shmTargetBytes)}).
            </span>
          </li>
          {remainderBytes > 0 ? (
            <li className="flex gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">4</span>
              <span>
                <span className="font-medium text-foreground">Remainder</span> — idle headroom left inside the budget
                because the shm ceiling is below 100% ({formatGibLabel(remainderBytes)}). Presets normally leave none;
                the real “leave room for the IDE” is a lower planning budget vs host total.
              </span>
            </li>
          ) : null}
        </ol>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-medium text-muted-foreground">Budget split</span>
            <span className="tabular-nums text-muted-foreground">{formatGibLabel(plan.budgetBytes)} total</span>
          </div>
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-muted/50"
            role="img"
            aria-label={`Budget split: reserve ${breakdown.reservePct.toFixed(0)}%, shared memory ${breakdown.shmPct.toFixed(0)}%, remainder ${breakdown.remainderPct.toFixed(0)}%`}
          >
            <Segment pct={breakdown.reservePct} className="bg-warning" title="Reserve" />
            <Segment pct={breakdown.shmPct} className="bg-success" title="Shared memory" />
            <Segment pct={breakdown.remainderPct} className="bg-muted-foreground/35" title="Remainder" />
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <LegendDot className="bg-warning" label={`OS reserve · ${formatGibLabel(plan.reserveBytes)}`} />
            <LegendDot className="bg-success" label={`Browsers (shm) · ${formatGibLabel(plan.shmTargetBytes)}`} />
            {remainderBytes > 0 ? (
              <LegendDot
                className="bg-muted-foreground/50"
                label={`Remainder · ${formatGibLabel(remainderBytes)}`}
              />
            ) : null}
          </div>
        </div>
      </DataCard>

      <DataCard className="space-y-3 p-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">What changes on apply</p>
          <p className="text-xs text-muted-foreground">
            Compare the live host / last plan with this preview. Green delta means more capacity; amber means less.
          </p>
        </div>

        <div className="overflow-hidden rounded-md border border-border">
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(4.5rem,0.7fr)_auto_minmax(4.5rem,0.7fr)_minmax(3.5rem,0.55fr)] gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Metric</span>
            <span className="text-right">Now</span>
            <span className="w-4" />
            <span className="text-right">After</span>
            <span className="text-right">Delta</span>
          </div>
          {comparisons.map((row) => (
            <CompareLine key={row.label} row={row} />
          ))}
          <CompareLimits
            raise={plan.raiseUlimits}
            beforeNofile={nowNofile}
            beforeNproc={nowNproc}
            afterNofile={plan.nofile}
            afterNproc={plan.nproc}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <StatusPill label={`Host CPU · ${plan.hostCpuCount}`} tone="neutral" />
          <StatusPill
            label={
              shmDeltaLabel(nowShm, plan.shmTargetBytes) ??
              `shm target · ${formatGibLabel(plan.shmTargetBytes)}`
            }
            tone={deltaTone(nowShm, plan.shmTargetBytes)}
          />
        </div>
      </DataCard>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onBack} disabled={pending}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={onApply} disabled={pending}>
          {pending ? (
            'Applying…'
          ) : (
            <>
              <Check className="h-4 w-4" />
              Apply resource plan
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

const GIB_EPS = 1024 ** 3 * 0.05

type CompareRow = {
  label: string
  hint: string
  before: number | null
  after: number
  emphasize?: boolean
}

function CompareLine({ row }: { row: CompareRow }) {
  const delta = row.before == null ? null : row.after - row.before
  return (
    <div
      className={cn(
        'grid grid-cols-[minmax(0,1.4fr)_minmax(4.5rem,0.7fr)_auto_minmax(4.5rem,0.7fr)_minmax(3.5rem,0.55fr)] items-center gap-2 border-b border-border/60 px-3 py-2.5 last:border-b-0',
        row.emphasize && 'bg-success/5',
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-foreground">{row.label}</p>
        <p className="truncate text-[10px] text-muted-foreground">{row.hint}</p>
      </div>
      <p className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {row.before == null ? '—' : formatGibLabel(row.before)}
      </p>
      <ArrowRight className="h-3 w-3 justify-self-center text-muted-foreground/70" aria-hidden />
      <p className="text-right font-mono text-[12px] font-medium tabular-nums text-foreground">
        {formatGibLabel(row.after)}
      </p>
      <p
        className={cn(
          'text-right font-mono text-[11px] tabular-nums',
          delta == null
            ? 'text-muted-foreground'
            : Math.abs(delta) < 1024 ** 2
              ? 'text-muted-foreground'
              : delta > 0
                ? 'text-success'
                : 'text-warning',
        )}
      >
        {formatDelta(delta)}
      </p>
    </div>
  )
}

function CompareLimits({
  raise,
  beforeNofile,
  beforeNproc,
  afterNofile,
  afterNproc,
}: {
  raise: boolean
  beforeNofile: number | null
  beforeNproc: number | null
  afterNofile: number
  afterNproc: number
}) {
  const after = raise
    ? `nofile ${formatCompactCount(afterNofile)} · nproc ${formatCompactCount(afterNproc)}`
    : 'Leave as-is'
  const before =
    beforeNofile != null || beforeNproc != null
      ? `nofile ${formatCompactCount(beforeNofile)} · nproc ${formatCompactCount(beforeNproc)}`
      : '—'
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(4.5rem,0.7fr)_auto_minmax(4.5rem,0.7fr)_minmax(3.5rem,0.55fr)] items-center gap-2 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-foreground">Process limits</p>
        <p className="truncate text-[10px] text-muted-foreground">Soft nofile / nproc targets on apply</p>
      </div>
      <p className="text-right font-mono text-[10px] tabular-nums text-muted-foreground">{before}</p>
      <ArrowRight className="h-3 w-3 justify-self-center text-muted-foreground/70" aria-hidden />
      <p className="text-right font-mono text-[11px] font-medium tabular-nums text-foreground">{after}</p>
      <p className="text-right font-mono text-[11px] text-muted-foreground">
        {raise ? 'set' : 'skip'}
      </p>
    </div>
  )
}

function formatDelta(delta: number | null): string {
  if (delta == null) return 'new'
  if (Math.abs(delta) < 1024 ** 2) return 'same'
  const sign = delta > 0 ? '+' : '−'
  return `${sign}${formatGibLabel(Math.abs(delta))}`
}

function shmDeltaLabel(before: number | null, after: number): string | null {
  if (before == null) return null
  const d = after - before
  if (Math.abs(d) < 1024 ** 2) return `shm unchanged · ${formatGibLabel(after)}`
  return `shm ${d > 0 ? '+' : '−'}${formatGibLabel(Math.abs(d))}`
}

function deltaTone(before: number | null, after: number): 'success' | 'warning' | 'neutral' | 'info' {
  if (before == null) return 'info'
  const d = after - before
  if (Math.abs(d) < 1024 ** 2) return 'neutral'
  return d > 0 ? 'success' : 'warning'
}

function Segment({ pct, className, title }: { pct: number; className: string; title: string }) {
  if (pct <= 0.05) return null
  return <div className={cn('h-full min-w-[2px]', className)} style={{ width: `${Math.min(100, pct)}%` }} title={title} />
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block h-2 w-2 rounded-full', className)} aria-hidden />
      {label}
    </span>
  )
}
