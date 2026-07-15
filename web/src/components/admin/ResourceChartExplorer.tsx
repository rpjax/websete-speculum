import { useCallback, useMemo, useRef, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  analyzePoint,
  bucketResourceSamples,
  nearestIndex,
  scaleSeries,
  toDatetimeLocalValue,
  parseDatetimeLocalValue,
  type AggFn,
  type Granularity,
  type MetricDef,
  type ResourceSample,
  type ScaleMode,
} from '@/lib/resourceChartCompute'
import { AlertTriangle, CalendarRange, Crosshair as CrosshairIcon, ZoomIn } from 'lucide-react'

export type { MetricDef } from '@/lib/resourceChartCompute'

interface ResourceChartExplorerProps {
  samples: ResourceSample[]
  metrics: MetricDef[]
  onBrushRange?: (from: number, to: number) => void
}

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'raw', label: 'Raw' },
  { value: 'auto', label: 'Auto' },
  { value: '1m', label: '1 min' },
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
]

const AGG_OPTIONS: { value: AggFn; label: string }[] = [
  { value: 'avg', label: 'Avg' },
  { value: 'max', label: 'Max' },
  { value: 'min', label: 'Min' },
  { value: 'last', label: 'Last' },
]

const SCALE_OPTIONS: { value: ScaleMode; label: string; hint: string }[] = [
  { value: 'absolute', label: 'Absolute', hint: 'Each metric keeps real units on independent Y-axes' },
  { value: 'normalized', label: 'Normalized', hint: '0–100% of each metric\'s range — best for shape correlation' },
  { value: 'indexed', label: 'Indexed', hint: '% change from period start — compare relative movement' },
]

export function ResourceChartExplorer({ samples, metrics, onBrushRange }: ResourceChartExplorerProps) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(['cpu', 'memory']))
  const [chartMode, setChartMode] = useState<'overlay' | 'stacked'>('overlay')
  const [scaleMode, setScaleMode] = useState<ScaleMode>('normalized')
  const [granularity, setGranularity] = useState<Granularity>('auto')
  const [aggFn, setAggFn] = useState<AggFn>('avg')
  const [showAvg, setShowAvg] = useState(true)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [brush, setBrush] = useState<{ start: number; end: number } | null>(null)
  const [brushing, setBrushing] = useState<{ startX: number; currX: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const chartSamples = useMemo(
    () => bucketResourceSamples(samples, granularity, aggFn),
    [samples, granularity, aggFn],
  )

  const activeMetrics = metrics.filter((m) => enabled.has(m.key))
  const timestamps = chartSamples.map((s) => s.timestamp)

  const insight = useMemo(
    () => (hoverIdx != null ? analyzePoint(chartSamples, hoverIdx) : null),
    [chartSamples, hoverIdx],
  )

  const divergencePoints = useMemo(() => {
    const set = new Set<number>()
    for (let i = 1; i < chartSamples.length; i++) {
      const pt = analyzePoint(chartSamples, i)
      if (pt && pt.divergences.length > 0) set.add(i)
    }
    return set
  }, [chartSamples])

  function toggleMetric(key: string) {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(key)) { if (next.size > 1) next.delete(key) }
      else next.add(key)
      return next
    })
  }

  const chartGeom = useMemo(() => ({
    W: 700, H: 280,
    pad: { l: 44, r: 44, t: 14, b: 22 },
  }), [])

  const plotW = chartGeom.W - chartGeom.pad.l - chartGeom.pad.r
  const plotH = chartGeom.H - chartGeom.pad.t - chartGeom.pad.b

  const xAt = useCallback((i: number) => {
    if (chartSamples.length < 2) return chartGeom.pad.l
    return chartGeom.pad.l + (i / (chartSamples.length - 1)) * plotW
  }, [chartSamples.length, chartGeom.pad.l, plotW])

  const pointerToIndex = useCallback((clientX: number) => {
    const svg = svgRef.current
    if (!svg || chartSamples.length === 0) return 0
    const rect = svg.getBoundingClientRect()
    const xRatio = (clientX - rect.left) / rect.width
    const innerRatio = (xRatio * chartGeom.W - chartGeom.pad.l) / plotW
    return nearestIndex(timestamps, innerRatio)
  }, [chartSamples.length, timestamps, chartGeom.W, chartGeom.pad.l, plotW])

  function onPointerMove(e: React.PointerEvent) {
    if (brushing) {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = ((e.clientX - rect.left) / rect.width) * chartGeom.W
      setBrushing((b) => b ? { ...b, currX: x } : null)
      return
    }
    setHoverIdx(pointerToIndex(e.clientX))
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((e.clientX - rect.left) / rect.width) * chartGeom.W
    if (e.shiftKey && onBrushRange) {
      setBrushing({ startX: x, currX: x })
      e.currentTarget.setPointerCapture(e.pointerId)
    } else {
      setHoverIdx(pointerToIndex(e.clientX))
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (brushing && onBrushRange) {
      const { startX, currX } = brushing
      const x1 = Math.min(startX, currX)
      const x2 = Math.max(startX, currX)
      if (x2 - x1 > 20 && chartSamples.length >= 2) {
        const r1 = (x1 - chartGeom.pad.l) / plotW
        const r2 = (x2 - chartGeom.pad.l) / plotW
        const i1 = nearestIndex(timestamps, r1)
        const i2 = nearestIndex(timestamps, r2)
        const from = Math.min(chartSamples[i1].timestamp, chartSamples[i2].timestamp)
        const to = Math.max(chartSamples[i1].timestamp, chartSamples[i2].timestamp)
        onBrushRange(from, to)
        setBrush({ start: from, end: to })
      }
      setBrushing(null)
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  function onPointerLeave() {
    if (!brushing) setHoverIdx(null)
  }

  const seriesData = useMemo(() => {
    return activeMetrics.map((m) => {
      const raw = chartSamples.map(m.extract)
      const scaled = scaleSeries(raw, scaleMode)
      return { ...m, raw, scaled: scaled.values, yMin: scaled.min, yMax: scaled.max, scaleUnit: scaled.unit }
    })
  }, [activeMetrics, chartSamples, scaleMode])

  if (samples.length < 2) {
    return (
      <div className="flex items-center justify-center py-20 text-xs text-muted-foreground">
        Not enough samples — need at least 2 data points
      </div>
    )
  }

  return (
    <div className="space-y-0">
      {/* Toolbar row 1: metrics + view mode */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/30 px-3 py-2">
        {metrics.map((m) => {
          const on = enabled.has(m.key)
          return (
            <button key={m.key} onClick={() => toggleMetric(m.key)}
              className={cn('flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium border transition-colors',
                on ? 'border-border/60 bg-muted/20 text-foreground' : 'border-transparent text-muted-foreground/40 hover:text-muted-foreground')}>
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: on ? m.color : 'transparent', border: `1.5px solid ${m.color}` }} />
              {m.label}
            </button>
          )
        })}

        <div className="h-4 w-px bg-border/30 mx-0.5" />

        <ViewToggle value={chartMode} options={['overlay', 'stacked']} labels={['Overlay', 'Stacked']} onChange={setChartMode} />

        <div className="h-4 w-px bg-border/30 mx-0.5" />

        <Select value={scaleMode} onValueChange={(v) => setScaleMode(v as ScaleMode)}>
          <SelectTrigger className="h-6 w-[100px] text-[10px] border-none bg-muted/15"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SCALE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                <span>{o.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button onClick={() => setShowAvg((v) => !v)}
          className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', showAvg ? 'bg-muted/30 text-foreground' : 'text-muted-foreground/50')}>
          Avg
        </button>

        {onBrushRange && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 ml-1">
                <ZoomIn className="h-3 w-3" /> Shift+drag to zoom
              </span>
            </TooltipTrigger>
            <TooltipContent>Hold Shift and drag on the chart to zoom into a time range</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Toolbar row 2: granularity + aggregation */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/30 px-3 py-1.5 bg-muted/5">
        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Granularity</span>
        <div className="flex rounded-md border border-border/40 overflow-hidden">
          {GRANULARITY_OPTIONS.map((g) => (
            <button key={g.value} onClick={() => setGranularity(g.value)}
              className={cn('px-2 py-0.5 text-[10px] font-medium transition-colors',
                granularity === g.value ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/20')}>
              {g.label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-border/30" />

        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Aggregate</span>
        <div className="flex rounded-md border border-border/40 overflow-hidden">
          {AGG_OPTIONS.map((a) => (
            <button key={a.value} onClick={() => setAggFn(a.value)}
              className={cn('px-2 py-0.5 text-[10px] font-medium transition-colors',
                aggFn === a.value ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/20')}>
              {a.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-[10px] text-muted-foreground/50 tabular-nums">
          {chartSamples.length} pts · {samples.length} raw
        </span>
      </div>

      {/* Chart + inspector side by side on wide screens */}
      <div className="grid lg:grid-cols-[1fr_200px]">
        <div className="px-2 py-1 relative">
          {chartMode === 'stacked' ? (
            <div className="divide-y divide-border/15">
              {seriesData.map((s) => (
                <StackedLane key={s.key} series={s} height={90} showAvg={showAvg} geom={chartGeom} />
              ))}
            </div>
          ) : (
            <svg ref={svgRef} viewBox={`0 0 ${chartGeom.W} ${chartGeom.H}`} className="w-full select-none touch-none"
              onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave}>
              {/* Grid */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <line key={f} x1={chartGeom.pad.l} x2={chartGeom.W - chartGeom.pad.r}
                  y1={chartGeom.pad.t + plotH * (1 - f)} y2={chartGeom.pad.t + plotH * (1 - f)}
                  className="stroke-border/10" strokeWidth={0.5} />
              ))}

              {/* Time axis */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                const idx = Math.round(f * (chartSamples.length - 1))
                return (
                  <text key={f} x={xAt(idx)} y={chartGeom.H - 4} textAnchor="middle"
                    className="fill-muted-foreground text-[7px]">
                    {new Date(timestamps[idx]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </text>
                )
              })}

              {/* Divergence markers */}
              {[...divergencePoints].map((i) => (
                <circle key={`div-${i}`} cx={xAt(i)} cy={chartGeom.pad.t + 6} r={3}
                  className="fill-amber-400/80" />
              ))}

              {/* Series */}
              {seriesData.map((s, si) => {
                const range = s.yMax - s.yMin || 1
                const pts = s.scaled.map((v, i) => ({
                  x: xAt(i),
                  y: chartGeom.pad.t + plotH - ((v - s.yMin) / range) * plotH,
                }))
                const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
                const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${chartGeom.pad.t + plotH} L${chartGeom.pad.l},${chartGeom.pad.t + plotH} Z`
                const avg = s.scaled.reduce((a, b) => a + b, 0) / s.scaled.length
                const avgY = chartGeom.pad.t + plotH - ((avg - s.yMin) / range) * plotH
                const axisX = scaleMode === 'absolute' && si > 0 ? chartGeom.W - chartGeom.pad.r : chartGeom.pad.l
                const anchor = scaleMode === 'absolute' && si > 0 ? 'start' as const : 'end' as const
                const offset = scaleMode === 'absolute' && si > 0 ? 4 : -4

                return (
                  <g key={s.key}>
                    <path d={area} fill={s.fill} />
                    <path d={line} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
                    {chartSamples.length <= 60 && pts.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={hoverIdx === i ? 3.5 : 1.8} fill={s.color}
                        opacity={hoverIdx === i ? 1 : 0.7} />
                    ))}
                    {showAvg && (
                      <line x1={chartGeom.pad.l} x2={chartGeom.W - chartGeom.pad.r} y1={avgY} y2={avgY}
                        stroke={s.color} strokeWidth={0.5} strokeDasharray="4 3" opacity={0.35} />
                    )}
                    {/* Y labels */}
                    {[0, 0.5, 1].map((f) => {
                      const val = s.yMin + range * f
                      const y = chartGeom.pad.t + plotH * (1 - f)
                      const label = scaleMode === 'absolute'
                        ? `${round1(s.raw[Math.round(f * (s.raw.length - 1))])}${s.unit}`
                        : `${round1(val)}${s.scaleUnit}`
                      return (
                        <text key={f} x={axisX + offset} y={y + 3} textAnchor={anchor}
                          fill={s.color} className="text-[7px]" opacity={0.55}>{label}</text>
                      )
                    })}
                  </g>
                )
              })}

              {/* Crosshair */}
              {hoverIdx != null && (
                <>
                  <line x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={chartGeom.pad.t} y2={chartGeom.pad.t + plotH}
                    className="stroke-foreground/25" strokeWidth={1} strokeDasharray="3 2" />
                  <CrosshairMarker x={xAt(hoverIdx)} y={chartGeom.pad.t + 4} />
                </>
              )}

              {/* Brush rectangle */}
              {brushing && (
                <rect
                  x={Math.min(brushing.startX, brushing.currX)}
                  y={chartGeom.pad.t}
                  width={Math.abs(brushing.currX - brushing.startX)}
                  height={plotH}
                  className="fill-primary/10 stroke-primary/40"
                  strokeWidth={1}
                />
              )}

              {/* Interaction overlay */}
              <rect x={chartGeom.pad.l} y={chartGeom.pad.t} width={plotW} height={plotH} fill="transparent" />
            </svg>
          )}

          {/* Scale mode hint */}
          <p className="px-1 pb-1 text-[9px] text-muted-foreground/40">
            {SCALE_OPTIONS.find((o) => o.value === scaleMode)?.hint}
            {divergencePoints.size > 0 && (
              <span className="ml-2 text-amber-400/70">● {divergencePoints.size} divergence{divergencePoints.size > 1 ? 's' : ''}</span>
            )}
          </p>
        </div>

        {/* Point inspector */}
        <div className="border-t lg:border-t-0 lg:border-l border-border/30 px-3 py-2 min-h-[120px]">
          {insight ? (
            <PointInspector insight={insight} metrics={metrics} scaleMode={scaleMode} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-6 text-center">
              <CrosshairIcon className="h-4 w-4 text-muted-foreground/20 mb-1" />
              <p className="text-[10px] text-muted-foreground/40">Hover chart to inspect</p>
              <p className="text-[9px] text-muted-foreground/30 mt-0.5">Shift+drag to zoom range</p>
            </div>
          )}
        </div>
      </div>

      {brush && (
        <div className="flex items-center gap-2 border-t border-border/30 px-3 py-1 text-[10px] text-muted-foreground">
          <CalendarRange className="h-3 w-3" />
          Zoomed: {new Date(brush.start).toLocaleTimeString()} → {new Date(brush.end).toLocaleTimeString()}
          <button onClick={() => setBrush(null)} className="text-primary hover:underline">Clear</button>
        </div>
      )}
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────── */

function PointInspector({ insight, metrics, scaleMode }: {
  insight: NonNullable<ReturnType<typeof analyzePoint>>
  metrics: MetricDef[]
  scaleMode: ScaleMode
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-medium text-muted-foreground tabular-nums">
        {new Date(insight.utc).toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>

      {metrics.map((m) => {
        const val = m.key === 'cpu' ? insight.cpu : m.key === 'memory' ? insight.memoryMb : insight.threads
        const delta = m.key === 'cpu' ? insight.cpuDelta : m.key === 'memory' ? insight.memoryDelta : insight.threadsDelta
        if (val == null && m.key === 'threads') return null
        return (
          <div key={m.key} className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: m.color }} />
              {m.label}
            </span>
            <div className="text-right">
              <span className="text-xs font-bold tabular-nums">
                {m.key === 'memory' ? `${Math.round(insight.memoryMb)} MB` : m.key === 'cpu' ? `${insight.cpu}%` : insight.threads}
              </span>
              {delta != null && (
                <span className={cn('ml-1 text-[10px] tabular-nums', delta > 0 ? 'text-amber-400' : delta < 0 ? 'text-emerald-400' : 'text-muted-foreground/50')}>
                  {delta > 0 ? '+' : ''}{m.key === 'memory' ? `${Math.round(delta)} MB` : m.key === 'cpu' ? `${round1(delta)}%` : delta}
                </span>
              )}
            </div>
          </div>
        )
      })}

      {insight.divergences.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border/20">
          {insight.divergences.map((d, i) => (
            <p key={i} className="flex items-start gap-1 text-[10px] text-amber-400/90 leading-tight">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" /> {d}
            </p>
          ))}
        </div>
      )}

      {scaleMode === 'normalized' && (
        <p className="text-[9px] text-muted-foreground/40 pt-1">Normalized view — compare shape, not absolute values</p>
      )}
    </div>
  )
}

function StackedLane({ series, height, showAvg, geom }: {
  series: { key: string; label: string; color: string; fill: string; unit: string; raw: number[]; scaled: number[]; yMin: number; yMax: number }
  height: number
  showAvg: boolean
  geom: { W: number; pad: { l: number; r: number; t: number; b: number } }
}) {
  const plotW = geom.W - geom.pad.l - geom.pad.r
  const plotH = height - geom.pad.t - geom.pad.b
  const range = series.yMax - series.yMin || 1

  const pts = series.scaled.map((v, i) => ({
    x: geom.pad.l + (i / (series.scaled.length - 1)) * plotW,
    y: geom.pad.t + plotH - ((v - series.yMin) / range) * plotH,
  }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${geom.pad.t + plotH} L${geom.pad.l},${geom.pad.t + plotH} Z`
  const avg = series.scaled.reduce((a, b) => a + b, 0) / series.scaled.length
  const avgY = geom.pad.t + plotH - ((avg - series.yMin) / range) * plotH

  return (
    <div className="px-1">
      <p className="text-[9px] font-medium mb-0" style={{ color: series.color }}>{series.label}</p>
      <svg viewBox={`0 0 ${geom.W} ${height}`} className="w-full">
        <path d={area} fill={series.fill} />
        <path d={line} fill="none" stroke={series.color} strokeWidth={1.5} />
        {showAvg && <line x1={geom.pad.l} x2={geom.W - geom.pad.r} y1={avgY} y2={avgY} stroke={series.color} strokeDasharray="3 3" opacity={0.3} />}
        <text x={geom.pad.l - 3} y={geom.pad.t + 8} textAnchor="end" fill={series.color} className="text-[6px]" opacity={0.5}>
          {round1(series.raw[series.raw.length - 1])}{series.unit}
        </text>
      </svg>
    </div>
  )
}

function ViewToggle<T extends string>({ value, options, labels, onChange }: {
  value: T; options: T[]; labels: string[]; onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-md border border-border/40 overflow-hidden">
      {options.map((opt, i) => (
        <button key={opt} onClick={() => onChange(opt)}
          className={cn('px-2 py-0.5 text-[10px] font-medium transition-colors',
            value === opt ? 'bg-muted/30 text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {labels[i]}
        </button>
      ))}
    </div>
  )
}

function CrosshairMarker({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={4} className="fill-none stroke-foreground/40" strokeWidth={1.5} />
    </g>
  )
}

function round1(n: number): string { return (Math.round(n * 10) / 10).toLocaleString() }

/* ── Time range controls (exported for page toolbar) ────────── */

export function ResourceTimeRangeControls({ preset, customFrom, customTo, onPresetChange, onCustomChange }: {
  preset: string
  customFrom: number | null
  customTo: number | null
  onPresetChange: (v: string) => void
  onCustomChange: (from: number | null, to: number | null) => void
}) {
  const PRESETS = [
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' },
    { value: '1h', label: '1h' },
    { value: '6h', label: '6h' },
    { value: '24h', label: '24h' },
    { value: 'all', label: 'All' },
  ]

  return (
    <div className="flex items-center gap-1">
      <div className="flex rounded-md border border-border/40 overflow-hidden">
        {PRESETS.map((p) => (
          <button key={p.value} onClick={() => onPresetChange(p.value)}
            className={cn('px-2 py-0.5 text-[10px] font-medium transition-colors',
              preset === p.value ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            {p.label}
          </button>
        ))}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn('h-6 px-2 text-[10px]', preset === 'custom' && 'bg-primary/15 text-primary')}>
            <CalendarRange className="h-3 w-3 mr-1" /> Custom
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3 space-y-2" align="end">
          <p className="text-xs font-medium">Custom range</p>
          <label className="block text-[10px] text-muted-foreground">From</label>
          <Input type="datetime-local" className="h-7 text-xs"
            value={customFrom != null ? toDatetimeLocalValue(customFrom) : ''}
            onChange={(e) => {
              const ts = parseDatetimeLocalValue(e.target.value)
              onCustomChange(ts, customTo)
              if (ts != null) onPresetChange('custom')
            }} />
          <label className="block text-[10px] text-muted-foreground">To</label>
          <Input type="datetime-local" className="h-7 text-xs"
            value={customTo != null ? toDatetimeLocalValue(customTo) : ''}
            onChange={(e) => {
              const ts = parseDatetimeLocalValue(e.target.value)
              onCustomChange(customFrom, ts)
              if (ts != null) onPresetChange('custom')
            }} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
