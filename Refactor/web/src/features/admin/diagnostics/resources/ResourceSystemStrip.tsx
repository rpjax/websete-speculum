import type { ResourceLatestResponse } from '@/lib/resourceMonitoringApi'
import { DataCard, ResourceGauge, StatusPill } from '@/features/admin/components'

function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KiB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`
  return `${(n / 1024 ** 3).toFixed(1)} GiB`
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

type Props = {
  latest: ResourceLatestResponse | null
  refreshing?: boolean
}

export function ResourceSystemStrip({ latest, refreshing }: Props) {
  const host = (latest?.sample?.host ?? null) as Record<string, unknown> | null
  const api = (latest?.sample?.apiProcess ?? null) as Record<string, unknown> | null
  const sessions = (latest?.sample?.sessions ?? null) as Record<string, unknown> | null

  if (!latest) {
    return (
      <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
        {refreshing ? 'Probing host…' : 'Host sample unavailable'}
      </div>
    )
  }

  if (!host && !api) {
    return (
      <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
        Live probe returned no host or API sections — enable those sections under Telemetry.
      </div>
    )
  }

  const cpu = num(host?.cpuUsage)
  const memUsed = num(host?.memoryUsed)
  const memTotal = num(host?.memoryTotal)
  const memPct = memUsed != null && memTotal && memTotal > 0 ? (100 * memUsed) / memTotal : null
  const diskFree = num(host?.diskFreeBytes)
  const diskTotal = num(host?.diskTotalBytes)
  const diskUsed =
    diskFree != null && diskTotal != null && diskTotal > 0 ? diskTotal - diskFree : null
  const diskPct =
    diskUsed != null && diskTotal && diskTotal > 0 ? (100 * diskUsed) / diskTotal : null
  const load = num(host?.loadAverage1m)
  const uptime = num(host?.uptimeSec)
  const hostname = str(host?.hostname) ?? '—'
  const source = str(host?.source) ?? ''
  const cpuCount = num(host?.cpuCount)

  const apiCpu = num(api?.cpuUsage)
  const apiMem = num(api?.memoryUsed)
  const apiThreads = num(api?.threadCount)
  const liveSessions = num(sessions?.live)

  const collectedLabel = new Date(latest.collectedAt).toLocaleTimeString()

  return (
    <div className="space-y-3" aria-label="Live host">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={`Now · ${collectedLabel}`} tone="info" />
        {source ? <StatusPill label={source} tone="neutral" /> : null}
        {liveSessions != null ? (
          <StatusPill
            label={`${liveSessions} live session${liveSessions === 1 ? '' : 's'}`}
            tone={liveSessions > 0 ? 'success' : 'neutral'}
          />
        ) : null}
        {refreshing ? <StatusPill label="Refreshing…" tone="neutral" /> : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <DataCard className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Host</p>
              <p className="truncate text-lg font-semibold tracking-tight">{hostname}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {uptime == null
                  ? 'Uptime unknown'
                  : `Up ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`}
                {cpuCount != null ? ` · ${cpuCount} CPU` : ''}
                {load != null ? ` · load ${load.toFixed(2)}` : ''}
              </p>
            </div>
            {cpu != null ? (
              <StatusPill
                label={`CPU ${cpu.toFixed(0)}%`}
                tone={cpu >= 95 ? 'danger' : cpu >= 85 ? 'warning' : 'success'}
              />
            ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {memPct != null ? (
              <ResourceGauge
                label="RAM"
                usedLabel={`${memPct.toFixed(0)}% · ${formatBytes(memUsed)} / ${formatBytes(memTotal)}`}
                percent={memPct}
                resource="ram"
              />
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                RAM not in this sample
              </div>
            )}
            {diskPct != null ? (
              <ResourceGauge
                label="Disk"
                usedLabel={`${diskPct.toFixed(0)}% · ${formatBytes(diskFree)} free`}
                percent={diskPct}
                resource="storage"
              />
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                Disk not in this sample
              </div>
            )}
          </div>
        </DataCard>

        <DataCard className="space-y-3 p-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">API process</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Speculum.Api on this node — same live probe
            </p>
          </div>
          {api ? (
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-border/60 bg-background/40 px-2 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">CPU</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                  {apiCpu == null ? '—' : `${apiCpu.toFixed(0)}%`}
                </dd>
              </div>
              <div className="rounded-md border border-border/60 bg-background/40 px-2 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Mem</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">{formatBytes(apiMem)}</dd>
              </div>
              <div className="rounded-md border border-border/60 bg-background/40 px-2 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Threads</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                  {apiThreads == null ? '—' : apiThreads}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">
              API section off — turn it on under Telemetry to include process pressure here.
            </p>
          )}
        </DataCard>
      </div>
    </div>
  )
}
