import { useMemo } from 'react'
import type { ScaleTime } from 'd3-scale'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { msToX } from '../canvas/TimeRail'

interface GovernanceBandLayerProps {
  events: DiagnosticsEventRecord[]
  scale: ScaleTime<number, number>
  width: number
  startMs: number
  endMs: number
}

interface Band {
  kind: 'degraded' | 'elevate'
  startMs: number
  endMs: number
}

function buildBands(events: DiagnosticsEventRecord[], endMs: number): Band[] {
  const ordered = [...events].sort((a, b) => a.utc.localeCompare(b.utc))
  const bands: Band[] = []
  let degradedStart: number | null = null
  let elevateStart: number | null = null

  for (const e of ordered) {
    const t = Date.parse(e.utc)
    if (e.name === 'Diagnostics.Degraded') degradedStart = t
    if (e.name === 'Diagnostics.Recovered' && degradedStart != null) {
      bands.push({ kind: 'degraded', startMs: degradedStart, endMs: t })
      degradedStart = null
    }
    if (e.name === 'Diagnostics.ElevateStarted') elevateStart = t
    if (e.name === 'Diagnostics.ElevateExpired' && elevateStart != null) {
      bands.push({ kind: 'elevate', startMs: elevateStart, endMs: t })
      elevateStart = null
    }
  }
  if (degradedStart != null) bands.push({ kind: 'degraded', startMs: degradedStart, endMs })
  if (elevateStart != null) bands.push({ kind: 'elevate', startMs: elevateStart, endMs })
  return bands
}

export function GovernanceBandLayer({ events, scale, width, endMs }: GovernanceBandLayerProps) {
  const bands = useMemo(() => buildBands(events, endMs), [events, endMs])

  if (bands.length === 0) return null

  return (
    <div className="relative h-6 border-b border-border/20" style={{ marginLeft: 160, width: width - 160 }}>
      {bands.map((b, i) => {
        const left = msToX(scale, b.startMs)
        const right = msToX(scale, b.endMs)
        return (
          <div
            key={`${b.kind}-${i}`}
            title={b.kind === 'degraded' ? 'Degraded window' : 'Elevate window'}
            className={
              b.kind === 'degraded'
                ? 'absolute inset-y-1 rounded-sm bg-destructive/20'
                : 'absolute inset-y-1 rounded-sm bg-violet-500/15'
            }
            style={{ left, width: Math.max(right - left, 4) }}
          />
        )
      })}
      <span className="pointer-events-none absolute left-2 top-1 text-[9px] uppercase tracking-wider text-muted-foreground">
        Governance
      </span>
    </div>
  )
}
