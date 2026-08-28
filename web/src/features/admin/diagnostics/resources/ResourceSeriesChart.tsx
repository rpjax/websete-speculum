import { scaleLinear, scaleTime } from 'd3-scale'
import { useMemo, useState } from 'react'
import type { MetricDef, ResourceSample } from '@/lib/resourceChartCompute'
import { TELEMETRY_METRICS } from '@/lib/resourceChartCompute'
import { cn } from '@/lib/utils'

type Props = {
  samples: ResourceSample[]
  metricKeys: string[]
  className?: string
  height?: number
}

export function ResourceSeriesChart({ samples, metricKeys, className, height = 280 }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const metrics = useMemo(
    () =>
      metricKeys
        .map((k) => TELEMETRY_METRICS.find((m) => m.key === k))
        .filter((m): m is MetricDef => Boolean(m)),
    [metricKeys],
  )

  const width = 720
  const pad = { t: 16, r: 16, b: 28, l: 44 }
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b

  const { x, y, paths, domain } = useMemo(() => {
    if (samples.length === 0 || metrics.length === 0) {
      return { x: null, y: null, paths: [] as { key: string; d: string; color: string }[], domain: null }
    }
    const t0 = samples[0].timestamp
    const t1 = samples[samples.length - 1].timestamp
    const xScale = scaleTime().domain([t0, t1 === t0 ? t0 + 1 : t1]).range([0, innerW])
    let min = Infinity
    let max = -Infinity
    for (const m of metrics) {
      for (const s of samples) {
        const v = m.extract(s)
        if (v == null || Number.isNaN(v)) continue
        min = Math.min(min, v)
        max = Math.max(max, v)
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0
      max = 1
    }
    if (min === max) {
      min -= 1
      max += 1
    }
    const yScale = scaleLinear().domain([min, max]).nice().range([innerH, 0])
    const built = metrics.map((m) => {
      const pts: string[] = []
      samples.forEach((s) => {
        const v = m.extract(s)
        if (v == null) return
        const cmd = pts.length === 0 ? 'M' : 'L'
        pts.push(`${cmd}${xScale(s.timestamp).toFixed(1)},${yScale(v).toFixed(1)}`)
      })
      return { key: m.key, d: pts.join(''), color: m.color, label: m.label }
    })
    return { x: xScale, y: yScale, paths: built, domain: { min, max, t0, t1 } }
  }, [samples, metrics, innerW, innerH])

  if (samples.length === 0) {
    return (
      <div className={cn('flex items-center justify-center rounded-md border bg-muted/20 text-sm text-muted-foreground', className)} style={{ height }}>
        No samples in this window
      </div>
    )
  }

  const hoverSample = hover != null ? samples[hover] : null

  return (
    <div className={cn('space-y-2', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full rounded-md border bg-card"
        role="img"
        aria-label="Resource series"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (!x || samples.length === 0) return
          const rect = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * width - pad.l
          let best = 0
          let bestDist = Infinity
          samples.forEach((s, i) => {
            const dx = Math.abs(x(s.timestamp) - px)
            if (dx < bestDist) {
              bestDist = dx
              best = i
            }
          })
          setHover(best)
        }}
      >
        <g transform={`translate(${pad.l},${pad.t})`}>
          {y && [0, 0.25, 0.5, 0.75, 1].map((t) => {
            const yy = innerH * (1 - t)
            const val = domain ? domain.min + (domain.max - domain.min) * t : 0
            return (
              <g key={t}>
                <line x1={0} x2={innerW} y1={yy} y2={yy} className="stroke-border" strokeWidth={1} />
                <text x={-8} y={yy + 3} textAnchor="end" className="fill-muted-foreground" fontSize={10}>
                  {val.toFixed(0)}
                </text>
              </g>
            )
          })}
          {paths.map((p) => (
            <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={2} />
          ))}
          {hover != null && x && (
            <line
              x1={x(samples[hover].timestamp)}
              x2={x(samples[hover].timestamp)}
              y1={0}
              y2={innerH}
              className="stroke-foreground/40"
              strokeDasharray="4 3"
            />
          )}
        </g>
      </svg>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {metrics.map((m) => (
          <span key={m.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: m.color }} />
            {m.label}
          </span>
        ))}
      </div>
      {hoverSample && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs" aria-live="polite">
          <div className="font-medium text-foreground">{new Date(hoverSample.utc).toLocaleString()}</div>
          <div className="mt-1 flex flex-wrap gap-3">
            {metrics.map((m) => {
              const v = m.extract(hoverSample)
              return (
                <span key={m.key}>
                  {m.label}: {v == null ? '—' : `${v.toFixed(1)} ${m.unit}`}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
