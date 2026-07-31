import { Cpu, HardDrive, MemoryStick, Server } from 'lucide-react'
import {
  DataCard,
  HelperCallout,
  NextBestAction,
  ResourceGauge,
  StatCard,
  StatusPill,
} from '@/features/admin/components'
import {
  describeLastApply,
  formatCompactCount,
  formatGibLabel,
  isShmBelowFloor,
  memoryUsePercent,
  type HostResourceProvisionParams,
  type HostResourceStatus,
} from './hostResourcesHelpers'

export function HostResourcesStatusHero({
  status,
  params,
}: {
  status: HostResourceStatus
  params: HostResourceProvisionParams
}) {
  if (status.hostError) {
    return (
      <HelperCallout tone="danger" title="Host status is unavailable">
        {status.hostError}
      </HelperCallout>
    )
  }

  const total = status.host?.memoryTotalBytes
  const available = status.host?.memoryAvailableBytes
  const shm = status.sidecar?.shmSizeBytes
  const usePct = memoryUsePercent(total, available)
  const shmLow = isShmBelowFloor(shm, params.shmMinBytes ?? null)
  const lastApplyLabel = describeLastApply(status.lastApply ?? null)
  const sidecarError = status.sidecar?.error

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <StatusPill
          label={total != null ? `Host · ${formatGibLabel(total)}` : 'Host · unknown'}
          tone={total != null ? 'success' : 'warning'}
        />
        <StatusPill
          label={shm != null ? `shm · ${formatGibLabel(shm)}` : 'shm · not reported'}
          tone={shmLow ? 'warning' : shm != null ? 'success' : 'neutral'}
        />
        <StatusPill
          label={`CPU · ${status.host?.cpuCount ?? '—'}`}
          tone={status.host?.cpuCount != null ? 'neutral' : 'warning'}
        />
        {status.lastApply?.appliedAtUtc ? (
          <StatusPill label="Plan applied previously" tone="success" />
        ) : (
          <StatusPill label="No apply yet" tone="neutral" />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Host memory"
          value={formatGibLabel(total)}
          icon={<Server className="h-4 w-4" />}
          sub={available != null ? `${formatGibLabel(available)} available` : 'Total RAM reported by the host'}
          progress={usePct ?? undefined}
          tone={usePct != null && usePct > 90 ? 'warning' : 'default'}
        />
        <StatCard
          label="Available"
          value={formatGibLabel(available)}
          icon={<MemoryStick className="h-4 w-4" />}
          sub="Free memory right now"
          tone={available != null && total != null && available / total < 0.1 ? 'warning' : 'default'}
        />
        <StatCard
          label="Shared memory"
          value={formatGibLabel(shm)}
          icon={<HardDrive className="h-4 w-4" />}
          sub={shmLow ? 'Below your planned minimum' : 'Sidecar /dev/shm'}
          tone={shmLow ? 'warning' : 'default'}
        />
        <StatCard
          label="CPU count"
          value={status.host?.cpuCount ?? '—'}
          icon={<Cpu className="h-4 w-4" />}
          sub={`nofile ${formatCompactCount(status.sidecar?.nofile)} · nproc ${formatCompactCount(status.sidecar?.nproc)}`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {usePct != null && total != null && available != null ? (
          <ResourceGauge
            label="Host memory in use"
            usedLabel={`${formatGibLabel(total - available)} of ${formatGibLabel(total)}`}
            percent={usePct}
          />
        ) : null}
        {shm != null && total != null && total > 0 ? (
          <ResourceGauge
            label="Sidecar shared memory vs host"
            usedLabel={`${formatGibLabel(shm)} of ${formatGibLabel(total)}`}
            percent={(shm / total) * 100}
          />
        ) : null}
      </div>

      {sidecarError ? (
        <HelperCallout tone="warning" title="Sidecar status incomplete">
          {sidecarError}
        </HelperCallout>
      ) : null}

      {shmLow ? (
        <NextBestAction
          tone="warning"
          title="Shared memory looks low"
          body={`The sidecar reports ${formatGibLabel(shm)}, below the planned minimum of ${formatGibLabel(params.shmMinBytes)}. Review and apply a resource plan before admitting more sessions.`}
          ctaLabel="Stay on parameters"
          href="/admin/host-resources"
        />
      ) : null}

      {lastApplyLabel || status.lastApply ? (
        <DataCard className="space-y-2 p-4">
          <p className="text-sm font-medium">Last apply</p>
          <p className="text-xs text-muted-foreground">{lastApplyLabel}</p>
          {status.lastApply?.budgetBytes != null ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <MiniMetric label="Budget" value={formatGibLabel(status.lastApply.budgetBytes)} />
              <MiniMetric label="Reserve" value={formatGibLabel(status.lastApply.reserveBytes)} />
              <MiniMetric label="shm target" value={formatGibLabel(status.lastApply.shmTargetBytes)} />
            </div>
          ) : null}
          {status.lastApply?.warnings && status.lastApply.warnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {status.lastApply.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </DataCard>
      ) : null}
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
