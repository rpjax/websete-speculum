import type { HostTelemetry, TelemetrySampleRecord } from '@/lib/diagnosticsApi'
import { formatBytes } from '@/lib/diagnosticsConstants'
import { cn } from '@/lib/utils'
import { Cpu, Layers, Monitor, Server, Clock, Wifi, Database, Gauge } from 'lucide-react'

const SECTION_METRICS: Record<string, string[]> = {
  host: ['host.cpu', 'host.memory', 'host.diskFree', 'host.threads'],
  motor: ['motor.live', 'motor.capacityPct', 'motor.avgFps'],
  sidecar: ['sidecar.connected', 'sidecar.faulted'],
  persistence: ['persistence.stored', 'persistence.expiringSoon'],
  pipeline: ['pipeline.usedPct', 'pipeline.eventsDropped', 'pipeline.degraded'],
}

/** Compact multi-section live readout. Clicking a section selects Monitor metrics only. */
export function TelemetrySystemStrip({
  host,
  latest,
  onSelectSection,
}: {
  host: HostTelemetry | null
  latest: TelemetrySampleRecord | null
  onSelectSection?: (metricKeys: string[]) => void
}) {
  const p = latest?.payload
  const motor = p?.motor ?? null
  const sidecar = p?.sidecar ?? null
  const persistence = p?.persistence ?? null
  const pipeline = p?.pipeline ?? null
  const cpuPct = Math.round(host?.cpuUsage ?? p?.host?.cpuUsage ?? 0)
  const memUsed = host?.memoryUsed ?? p?.host?.memoryUsed ?? 0
  const memTotal = host?.memoryTotal ?? p?.host?.memoryTotal ?? 0
  const memPct = memTotal ? Math.round((memUsed / memTotal) * 100) : 0
  const disk = host?.diskFreeBytes ?? p?.host?.diskFreeBytes ?? null
  const threads = host?.threadCount ?? p?.host?.threadCount ?? null
  const live = motor?.live ?? null
  const capacityPct = motor?.capacityUsedPct != null ? Math.round(motor.capacityUsedPct) : null
  const avgFps = motor?.avgFps != null ? Math.round(motor.avgFps) : null
  const uptimeSec = host?.uptimeSec ?? 0
  const uptimeH = Math.round(uptimeSec / 3600)
  const pipePct = pipeline?.usedPct != null ? Math.round(pipeline.usedPct) : null

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <Server className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
        <span className="text-xs font-semibold truncate">{host?.hostname ?? '—'}</span>
        {uptimeSec > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
            <Clock className="h-2.5 w-2.5" />{Math.floor(uptimeH / 24)}d {uptimeH % 24}h
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground/40">Click a section to overlay its metrics</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Section
          title="Host" icon={<Cpu className="h-3 w-3" />}
          onClick={() => onSelectSection?.(SECTION_METRICS.host)}
          chips={[
            { label: 'CPU', value: `${cpuPct}%`, warn: cpuPct > 50, danger: cpuPct > 80 },
            { label: 'Mem', value: formatBytes(memUsed), warn: memPct > 60, danger: memPct > 85 },
            { label: 'Disk', value: disk != null ? formatBytes(disk) : '—' },
            { label: 'Thr', value: threads != null ? String(threads) : '—' },
          ]}
        />
        <Section
          title="Motor" icon={<Monitor className="h-3 w-3" />}
          onClick={() => onSelectSection?.(SECTION_METRICS.motor)}
          chips={[
            { label: 'Live', value: live != null ? String(live) : '—', accent: true },
            { label: 'Cap', value: capacityPct != null ? `${capacityPct}%` : '—', warn: (capacityPct ?? 0) > 80 },
            { label: 'FPS', value: avgFps != null ? String(avgFps) : '—' },
          ]}
        />
        <Section
          title="Sidecar" icon={<Wifi className="h-3 w-3" />}
          onClick={() => onSelectSection?.(SECTION_METRICS.sidecar)}
          chips={[
            { label: 'OK', value: sidecar?.connected != null ? String(sidecar.connected) : '—' },
            { label: 'Fault', value: sidecar?.faulted != null ? String(sidecar.faulted) : '—', danger: (sidecar?.faulted ?? 0) > 0 },
          ]}
        />
        <Section
          title="Persistence" icon={<Database className="h-3 w-3" />}
          onClick={() => onSelectSection?.(SECTION_METRICS.persistence)}
          chips={[
            { label: 'Stored', value: persistence?.storedSessions != null ? String(persistence.storedSessions) : '—' },
            { label: 'Expiring', value: persistence?.expiringSoon != null ? String(persistence.expiringSoon) : '—', warn: (persistence?.expiringSoon ?? 0) > 0 },
          ]}
        />
        <Section
          title="Pipeline" icon={<Gauge className="h-3 w-3" />}
          onClick={() => onSelectSection?.(SECTION_METRICS.pipeline)}
          chips={[
            { label: 'Used', value: pipePct != null ? `${pipePct}%` : '—', warn: (pipePct ?? 0) > 70, danger: (pipePct ?? 0) > 90 },
            { label: 'Drops', value: pipeline?.eventsDropped != null ? String(pipeline.eventsDropped) : '—', danger: (pipeline?.eventsDropped ?? 0) > 0 },
            { label: 'State', value: pipeline?.degraded ? 'Degraded' : pipeline?.elevateActive ? 'Elevate' : 'OK', danger: !!pipeline?.degraded, warn: !!pipeline?.elevateActive },
          ]}
        />
      </div>
    </div>
  )
}

function Section({ title, icon, chips, onClick }: {
  title: string
  icon: React.ReactNode
  chips: { label: string; value: string; warn?: boolean; danger?: boolean; accent?: boolean }[]
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border/40 bg-muted/5 px-2 py-1.5 text-left hover:bg-muted/15 transition-colors"
    >
      <div className="flex items-center gap-1 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="text-muted-foreground/50">{icon}</span>
        {title}
        <Layers className="ml-auto h-2.5 w-2.5 opacity-30" />
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {chips.map((c) => (
          <span key={c.label} className="text-[11px] tabular-nums">
            <span className="text-muted-foreground/50 mr-0.5">{c.label}</span>
            <span className={cn('font-bold',
              c.danger ? 'text-red-400' : c.warn ? 'text-amber-400' : c.accent ? 'text-amber-300' : '')}>
              {c.value}
            </span>
          </span>
        ))}
      </div>
    </button>
  )
}
