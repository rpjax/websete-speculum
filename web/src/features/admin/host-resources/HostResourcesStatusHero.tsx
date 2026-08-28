import { HardDrive, Layers, MemoryStick } from 'lucide-react'
import {
  DataCard,
  HelperCallout,
  NextBestAction,
  StatusPill,
} from '@/features/admin/components'
import {
  describeLastApply,
  diskUsePercent,
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
  const diskTotal = status.host?.diskTotalBytes
  const diskFree = status.host?.diskFreeBytes
  const ramUsePct = memoryUsePercent(total, available)
  const diskUsePct = diskUsePercent(diskTotal, diskFree)
  const shmLow = isShmBelowFloor(shm, params.shmMinBytes ?? null)
  const lastApplyLabel = describeLastApply(status.lastApply ?? null)
  const sidecarError = status.sidecar?.error
  const diskReported = diskTotal != null && diskTotal > 0 && diskFree != null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <StatusPill
          label={total != null ? `RAM · ${formatGibLabel(total)}` : 'RAM · unknown'}
          tone={total != null ? 'success' : 'warning'}
        />
        <StatusPill
          label={diskReported ? `Disk · ${formatGibLabel(diskTotal)}` : 'Disk · not reported'}
          tone={diskReported ? 'success' : 'warning'}
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

      <section className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-primary">Memory (RAM)</h2>
          <p className="text-[11px] text-muted-foreground">Live host snapshot · planning still uses total, not free</p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {total != null ? (
            <DataCard className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Host RAM</p>
                  <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight">{formatGibLabel(total)}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Total installed on this machine</p>
                </div>
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-primary">
                  <MemoryStick className="h-4 w-4" />
                </div>
              </div>

              {available != null && ramUsePct != null ? (
                <>
                  <div
                    className="flex h-3 w-full overflow-hidden rounded-full bg-muted/50"
                    role="img"
                    aria-label={`Host RAM: ${formatGibLabel(total - available)} in use, ${formatGibLabel(available)} free`}
                  >
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.min(100, Math.max(0, ramUsePct))}%` }}
                      title="In use"
                    />
                    <div
                      className="h-full bg-muted-foreground/25"
                      style={{ width: `${Math.min(100, Math.max(0, 100 - ramUsePct))}%` }}
                      title="Free now"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <p className="text-muted-foreground">In use now</p>
                      <p className="font-medium tabular-nums text-foreground">{formatGibLabel(total - available)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Free now</p>
                      <p className="font-medium tabular-nums text-foreground">{formatGibLabel(available)}</p>
                    </div>
                  </div>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Free is a live snapshot — Speculum and other processes already hold memory. Resource plans size
                    against the <span className="font-medium text-foreground">total</span>, not this free number.
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">Free / in-use split not reported yet.</p>
              )}
            </DataCard>
          ) : (
            <HelperCallout tone="warning" title="Host RAM not reported">
              The host memory probe did not return a total.
            </HelperCallout>
          )}

          <DataCard className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Browser shared memory</p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight">{formatGibLabel(shm)}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Sidecar <span className="font-mono">/dev/shm</span> allocation (RAM-backed)
                </p>
              </div>
              <div
                className={
                  shmLow
                    ? 'grid h-8 w-8 place-items-center rounded-lg bg-warning/15 text-warning'
                    : 'grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-primary'
                }
              >
                <Layers className="h-4 w-4" />
              </div>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Capacity reserved for browser sessions — not “free host RAM” and not disk. Apply a plan to change this
              size.
            </p>
            {shmLow ? (
              <p className="text-[11px] text-warning">
                Below planned minimum ({formatGibLabel(params.shmMinBytes)}).
              </p>
            ) : params.shmMinBytes != null && shm != null ? (
              <p className="text-[11px] text-muted-foreground">
                At or above planned minimum ({formatGibLabel(params.shmMinBytes)}).
              </p>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              CPU · {status.host?.cpuCount ?? '—'}
              {status.sidecar?.nofile != null || status.sidecar?.nproc != null
                ? ` · nofile ${formatCompactCount(status.sidecar?.nofile)} · nproc ${formatCompactCount(status.sidecar?.nproc)}`
                : null}
            </p>
          </DataCard>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-success">Storage (disk)</h2>
          <p className="text-[11px] text-muted-foreground">Persistent filesystem — separate from RAM / shm</p>
        </div>
        {diskReported ? (
          <DataCard className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Disk capacity</p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight">{formatGibLabel(diskTotal)}</p>
              </div>
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-success/15 text-success">
                <HardDrive className="h-4 w-4" />
              </div>
            </div>
            {diskUsePct != null && diskFree != null ? (
              <>
                <div
                  className="flex h-3 w-full overflow-hidden rounded-full bg-muted/50"
                  role="img"
                  aria-label={`Disk: ${formatGibLabel(diskTotal! - diskFree)} used, ${formatGibLabel(diskFree)} free`}
                >
                  <div
                    className="h-full bg-success"
                    style={{ width: `${Math.min(100, Math.max(0, diskUsePct))}%` }}
                    title="Used"
                  />
                  <div
                    className="h-full bg-muted-foreground/25"
                    style={{ width: `${Math.min(100, Math.max(0, 100 - diskUsePct))}%` }}
                    title="Free"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <p className="text-muted-foreground">Used</p>
                    <p className="font-medium tabular-nums">{formatGibLabel(diskTotal! - diskFree)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Free</p>
                    <p className="font-medium tabular-nums">{formatGibLabel(diskFree)}</p>
                  </div>
                </div>
              </>
            ) : null}
          </DataCard>
        ) : (
          <HelperCallout tone="warning" title="Disk not reported">
            The host probe did not return filesystem capacity. Check Telemetry.Host.DiskPath / proc mounts.
          </HelperCallout>
        )}
      </section>

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
          href="/w7s/admin/host-resources"
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

      <NextBestAction
        title="Watch live resources"
        body="Continuous CPU, RAM, and disk series live under Diagnostics."
        ctaLabel="Open resources"
        href="/w7s/admin/diagnostics/resources"
      />
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
