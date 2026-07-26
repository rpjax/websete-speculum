import type { HostTelemetry, TelemetrySampleRecord } from '@/lib/diagnosticsApi'
import { formatBytes } from '@/lib/diagnosticsConstants'
import { cn } from '@/lib/utils'
import { Server, Clock, Cpu, MemoryStick, HardDrive, Activity } from 'lucide-react'

/** Machine-only live readout — runtime overlays belong in the chart + Metric picker. */
export function TelemetrySystemStrip({
  host,
  latest,
}: {
  host: HostTelemetry | null
  latest: TelemetrySampleRecord | null
}) {
  const sampleHost = latest?.payload?.host ?? null
  const hostCpuRaw = host?.cpuUsage ?? sampleHost?.cpuUsage
  const hostMemRaw = host?.memoryUsed ?? sampleHost?.memoryUsed
  const hostMemTotalRaw = host?.memoryTotal ?? sampleHost?.memoryTotal
  const diskFree = host?.diskFreeBytes ?? sampleHost?.diskFreeBytes ?? null
  const diskTotal = host?.diskTotalBytes ?? sampleHost?.diskTotalBytes ?? null
  const load1m = host?.loadAverage1m ?? sampleHost?.loadAverage1m ?? null
  const cpuPct = typeof hostCpuRaw === 'number' ? Math.round(hostCpuRaw) : null
  const memUsed = typeof hostMemRaw === 'number' ? hostMemRaw : null
  const memTotal = typeof hostMemTotalRaw === 'number' ? hostMemTotalRaw : null
  const memPct = memUsed != null && memTotal ? Math.round((memUsed / memTotal) * 100) : null
  const diskPct = diskFree != null && diskTotal ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : null
  const uptimeSec = host?.uptimeSec ?? sampleHost?.uptimeSec ?? 0
  const uptimeH = Math.round(uptimeSec / 3600)
  const hostname = host?.hostname ?? sampleHost?.hostname ?? '—'
  const source = host?.source ?? sampleHost?.source

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <Server className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
        <span className="text-xs font-semibold truncate">{hostname}</span>
        {source && source !== 'machine' && (
          <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold text-warning">{source}</span>
        )}
        {uptimeSec > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
            <Clock className="h-2.5 w-2.5" />{Math.floor(uptimeH / 24)}d {uptimeH % 24}h
          </span>
        )}
        <span className="hidden sm:inline ml-auto text-[10px] text-muted-foreground/50">
          Machine resources · add API process, motor, or pipeline via + Metric
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] tabular-nums">
        <Metric
          icon={<Cpu className="h-3 w-3" />}
          label="CPU"
          value={cpuPct != null ? `${cpuPct}%` : '—'}
          pct={cpuPct}
          warn={(cpuPct ?? 0) > 50}
          danger={(cpuPct ?? 0) > 80}
        />
        <Metric
          icon={<MemoryStick className="h-3 w-3" />}
          label="Memory"
          value={memUsed != null ? formatBytes(memUsed) : '—'}
          suffix={memTotal != null ? ` / ${formatBytes(memTotal)}` : undefined}
          pct={memPct}
          warn={(memPct ?? 0) > 60}
          danger={(memPct ?? 0) > 85}
        />
        <Metric
          icon={<HardDrive className="h-3 w-3" />}
          label="Disk free"
          value={diskFree != null ? formatBytes(diskFree) : '—'}
          suffix={diskTotal != null ? ` / ${formatBytes(diskTotal)}` : undefined}
          pct={diskPct != null ? 100 - diskPct : null}
          warn={diskPct != null && diskPct > 80}
          danger={diskPct != null && diskPct > 92}
        />
        {load1m != null && (
          <Metric
            icon={<Activity className="h-3 w-3" />}
            label="Load 1m"
            value={load1m.toFixed(2)}
          />
        )}
      </div>
    </div>
  )
}

function Metric({
  icon, label, value, suffix, pct, warn, danger,
}: {
  icon: React.ReactNode
  label: string
  value: string
  suffix?: string
  pct?: number | null
  warn?: boolean
  danger?: boolean
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground/40">{icon}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{label}</span>
      <span className={cn('font-bold', danger ? 'text-red-400' : warn ? 'text-amber-400' : '')}>
        {value}
        {suffix && <span className="font-normal text-muted-foreground/50">{suffix}</span>}
      </span>
      {pct != null && (
        <span className="inline-block h-1 w-10 overflow-hidden rounded-full bg-muted/25 align-middle">
          <span
            className={cn('block h-full rounded-full', danger ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-emerald-500')}
            style={{ width: `${Math.max(Math.min(pct, 100), 3)}%` }}
          />
        </span>
      )}
    </span>
  )
}
