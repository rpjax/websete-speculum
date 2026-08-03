import type { ResourceLatestResponse } from '@/lib/resourceMonitoringApi'
import { StatusPill } from '@/features/admin/components'

function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KiB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`
  return `${(n / 1024 ** 3).toFixed(1)} GiB`
}

type Props = {
  latest: ResourceLatestResponse | null
}

export function ResourceSystemStrip({ latest }: Props) {
  const host = (latest?.sample?.host ?? null) as Record<string, unknown> | null
  if (!latest?.telemetryEnabled) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Host sample unavailable — Telemetry sampling is off.
      </div>
    )
  }
  if (!host) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Host sample unavailable
      </div>
    )
  }

  const cpu = typeof host.cpuUsage === 'number' ? host.cpuUsage : null
  const memUsed = typeof host.memoryUsed === 'number' ? host.memoryUsed : null
  const memTotal = typeof host.memoryTotal === 'number' ? host.memoryTotal : null
  const memPct = memUsed != null && memTotal && memTotal > 0 ? (100 * memUsed) / memTotal : null
  const diskFree = typeof host.diskFreeBytes === 'number' ? host.diskFreeBytes : null
  const diskTotal = typeof host.diskTotalBytes === 'number' ? host.diskTotalBytes : null
  const load = typeof host.loadAverage1m === 'number' ? host.loadAverage1m : null
  const uptime = typeof host.uptimeSec === 'number' ? host.uptimeSec : null
  const hostname = typeof host.hostname === 'string' ? host.hostname : '—'
  const source = typeof host.source === 'string' ? host.source : ''

  const cpuTone = cpu != null && cpu >= 95 ? 'danger' : cpu != null && cpu >= 85 ? 'warning' : 'success'
  const memTone = memPct != null && memPct >= 95 ? 'danger' : memPct != null && memPct >= 85 ? 'warning' : 'success'

  return (
    <div className="grid gap-2 rounded-md border bg-card px-3 py-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="Live host">
      <div>
        <div className="text-xs text-muted-foreground">Host</div>
        <div className="truncate text-sm font-medium">{hostname}</div>
        <div className="text-xs text-muted-foreground">{source}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Up</div>
        <div className="text-sm font-medium">
          {uptime == null ? '—' : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`}
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          CPU <StatusPill label={cpu == null ? '—' : `${cpu.toFixed(0)}%`} tone={cpuTone} />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          Memory{' '}
          <StatusPill
            label={memPct == null ? '—' : `${memPct.toFixed(0)}%`}
            tone={memTone}
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {formatBytes(memUsed)} / {formatBytes(memTotal)}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Disk</div>
        <div className="text-sm font-medium">
          {formatBytes(diskFree)} free
        </div>
        <div className="text-xs text-muted-foreground">of {formatBytes(diskTotal)}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Load</div>
        <div className="text-sm font-medium">{load == null ? '—' : load.toFixed(2)}</div>
      </div>
    </div>
  )
}
