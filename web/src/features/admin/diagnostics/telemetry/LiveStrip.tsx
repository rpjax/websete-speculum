import type { HostTelemetry, TelemetrySampleRecord } from '@/lib/diagnosticsApi'
import { formatBytes } from '@/lib/diagnosticsConstants'
import { cn } from '@/lib/utils'
import { Cpu, MemoryStick, HardDrive, Layers, Monitor, Server, Clock } from 'lucide-react'

/** Compact single-row live readout of host + motor state at the newest sample. */
export function LiveStrip({
  host,
  latest,
}: {
  host: HostTelemetry | null
  latest: TelemetrySampleRecord | null
}) {
  const motor = latest?.payload?.motor ?? null
  const cpuPct = Math.round(host?.cpuUsage ?? latest?.payload?.host?.cpuUsage ?? 0)
  const memUsed = host?.memoryUsed ?? latest?.payload?.host?.memoryUsed ?? 0
  const memTotal = host?.memoryTotal ?? latest?.payload?.host?.memoryTotal ?? 0
  const memPct = memTotal ? Math.round((memUsed / memTotal) * 100) : 0
  const disk = host?.diskFreeBytes ?? latest?.payload?.host?.diskFreeBytes ?? null
  const threads = host?.threadCount ?? latest?.payload?.host?.threadCount ?? null
  const live = motor?.live ?? null
  const capacityPct = motor?.capacityUsedPct != null ? Math.round(motor.capacityUsedPct) : null
  const uptimeSec = host?.uptimeSec ?? 0
  const uptimeH = Math.round(uptimeSec / 3600)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Server className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
        <span className="text-xs font-semibold truncate">{host?.hostname ?? '—'}</span>
        {uptimeSec > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
            <Clock className="h-2.5 w-2.5" />{Math.floor(uptimeH / 24)}d {uptimeH % 24}h
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] tabular-nums">
        <LiveChip icon={<Monitor className="h-3 w-3" />} label="Sessions" value={live != null ? String(live) : '—'}
          pct={capacityPct} accent="amber" />
        <LiveChip icon={<Cpu className="h-3 w-3" />} label="CPU" value={`${cpuPct}%`} pct={cpuPct}
          warn={cpuPct > 50} danger={cpuPct > 80} />
        <LiveChip icon={<MemoryStick className="h-3 w-3" />} label="Memory" value={formatBytes(memUsed)} pct={memPct}
          warn={memPct > 60} danger={memPct > 85} />
        <LiveChip icon={<HardDrive className="h-3 w-3" />} label="Disk free" value={disk != null ? formatBytes(disk) : '—'} />
        <LiveChip icon={<Layers className="h-3 w-3" />} label="Threads" value={threads != null ? String(threads) : '—'} />
      </div>
    </div>
  )
}

function LiveChip({ icon, label, value, pct, warn, danger, accent }: {
  icon: React.ReactNode
  label: string
  value: string
  pct?: number | null
  warn?: boolean
  danger?: boolean
  accent?: 'amber'
}) {
  const valueColor = danger ? 'text-red-400' : warn ? 'text-amber-400' : accent === 'amber' ? 'text-amber-300' : ''
  const barColor = danger ? 'bg-red-500' : warn ? 'bg-amber-500' : accent === 'amber' ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground/40">{icon}</span>
      <span className="text-muted-foreground/60 text-[10px] uppercase tracking-wide">{label}</span>
      <span className={cn('font-bold', valueColor)}>{value}</span>
      {pct != null && (
        <span className="w-8 h-1 rounded-full bg-muted/25 overflow-hidden inline-block align-middle">
          <span className={cn('block h-full rounded-full', barColor)} style={{ width: `${Math.max(Math.min(pct, 100), 3)}%` }} />
        </span>
      )}
    </span>
  )
}
