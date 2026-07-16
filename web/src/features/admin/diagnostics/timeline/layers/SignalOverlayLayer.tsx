import { useEffect, useMemo, useState } from 'react'
import type { ScaleTime } from 'd3-scale'
import { diagnosticsApi, type TelemetrySampleRecord } from '@/lib/diagnosticsApi'
import { msToX } from '../canvas/TimeRail'

interface SignalOverlayLayerProps {
  startMs: number
  endMs: number
  width: number
  scale: ScaleTime<number, number>
}

/**
 * Optional machine-CPU sparkline overlay — coadjutant to the narrative, off by default.
 * Uses host section only; API-process CPU is a separate signal (plot via Monitor metrics).
 */
export function SignalOverlayLayer({ startMs, endMs, width, scale }: SignalOverlayLayerProps) {
  const [samples, setSamples] = useState<TelemetrySampleRecord[]>([])

  useEffect(() => {
    let cancelled = false
    void diagnosticsApi
      .getSampleHistory({
        since: new Date(startMs).toISOString(),
        until: new Date(endMs).toISOString(),
        bucketSeconds: Math.max(30, Math.round((endMs - startMs) / 60_000)),
        limit: 120,
      })
      .then((r) => {
        if (!cancelled) setSamples(r.items)
      })
      .catch(() => {
        if (!cancelled) setSamples([])
      })
    return () => { cancelled = true }
  }, [startMs, endMs])

  const points = useMemo(() => {
    return samples
      .map((s) => {
        const cpu = s.payload?.host?.cpuUsage
        if (typeof cpu !== 'number') return null
        return { ms: Date.parse(s.utc), cpu }
      })
      .filter((p): p is { ms: number; cpu: number } => p != null)
  }, [samples])

  if (points.length < 2) {
    return (
      <div className="border-b border-border/20 px-3 py-2 text-[10px] text-muted-foreground" style={{ marginLeft: 160 }}>
        Signal overlay: no machine CPU samples in range
      </div>
    )
  }

  const maxCpu = Math.max(...points.map((p) => p.cpu), 1)
  const h = 36
  const path = points
    .map((p, i) => {
      const x = msToX(scale, p.ms)
      const y = h - (p.cpu / maxCpu) * (h - 4) - 2
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')

  return (
    <div className="border-b border-border/20" style={{ marginLeft: 160 }}>
      <svg width={width - 160} height={h} className="block text-amber-400/70">
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
        <text x={8} y={12} className="fill-muted-foreground text-[9px]">Machine CPU (telemetry)</text>
      </svg>
    </div>
  )
}
