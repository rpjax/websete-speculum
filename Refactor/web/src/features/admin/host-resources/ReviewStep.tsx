import { Check, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DataCard,
  HelperCallout,
  ResourceGauge,
  StatCard,
  StatusPill,
} from '@/features/admin/components'
import {
  formatCompactCount,
  formatGibLabel,
  planBreakdownPercents,
  type HostResourceProvisionPlan,
} from './hostResourcesHelpers'

export function ReviewStep({
  plan,
  onBack,
  onApply,
  pending,
}: {
  plan: HostResourceProvisionPlan
  onBack: () => void
  onApply: () => void
  pending: boolean
}) {
  const breakdown = planBreakdownPercents(plan)
  const remainderBytes = Math.max(0, plan.budgetBytes - plan.reserveBytes - plan.shmTargetBytes)

  return (
    <div className="space-y-5">
      <HelperCallout tone="warning" title="Applying changes affects future sidecar capacity">
        Confirm the computed budget before mutating host shared memory. Existing live sessions are not resized by this
        apply — review status after apply before admitting additional load.
      </HelperCallout>

      <div className="flex flex-wrap gap-2">
        <StatusPill label={`Budget · ${formatGibLabel(plan.budgetBytes)}`} tone="info" />
        <StatusPill label={`Reserve · ${formatGibLabel(plan.reserveBytes)}`} tone="neutral" />
        <StatusPill label={`shm · ${formatGibLabel(plan.shmTargetBytes)}`} tone="success" />
        <StatusPill
          label={plan.raiseUlimits ? `ulimits · nofile ${formatCompactCount(plan.nofile)}` : 'ulimits · leave as-is'}
          tone={plan.raiseUlimits ? 'info' : 'neutral'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Memory budget"
          value={formatGibLabel(plan.budgetBytes)}
          sub={`of ${formatGibLabel(plan.hostMemoryTotalBytes)} host total`}
          progress={(plan.budgetBytes / Math.max(1, plan.hostMemoryTotalBytes)) * 100}
        />
        <StatCard
          label="Host reserve"
          value={formatGibLabel(plan.reserveBytes)}
          sub={`${breakdown.reservePct.toFixed(0)}% of budget`}
          progress={breakdown.reservePct}
          tone="warning"
        />
        <StatCard
          label="Shared memory target"
          value={formatGibLabel(plan.shmTargetBytes)}
          sub={`${breakdown.shmPct.toFixed(0)}% of budget`}
          progress={breakdown.shmPct}
          tone="success"
        />
      </div>

      <DataCard className="space-y-3 p-4">
        <p className="text-sm font-medium">Budget breakdown</p>
        <p className="text-xs text-muted-foreground">
          Server preview: reserve is taken first, then shared memory is clamped between the minimum and the percent
          cap.
        </p>
        <ResourceGauge
          label="Reserve"
          usedLabel={formatGibLabel(plan.reserveBytes)}
          percent={breakdown.reservePct}
        />
        <ResourceGauge
          label="Shared memory"
          usedLabel={formatGibLabel(plan.shmTargetBytes)}
          percent={breakdown.shmPct}
        />
        {remainderBytes > 0 ? (
          <ResourceGauge
            label="Remainder in budget"
            usedLabel={formatGibLabel(remainderBytes)}
            percent={breakdown.remainderPct}
          />
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <MiniMetric label="Host CPU" value={String(plan.hostCpuCount)} />
          <MiniMetric
            label="Process limits"
            value={
              plan.raiseUlimits
                ? `nofile ${formatCompactCount(plan.nofile)} · nproc ${formatCompactCount(plan.nproc)}`
                : 'Unchanged'
            }
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

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-2.5 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  )
}
