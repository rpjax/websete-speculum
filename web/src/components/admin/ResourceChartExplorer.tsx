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
  metricsBySection,
  nearestIndex,
  pearson,
  scaleSeries,
  toDatetimeLocalValue,
  parseDatetimeLocalValue,
  type AggFn,
  type Granularity,
  type MetricDef,
  type ResourceSample,
  type ScaleMode,
} from '@/lib/resourceChartCompute'
import {
  AlertTriangle, CalendarRange, Crosshair as CrosshairIcon, Plus, X,
  ZoomIn, LineChart, Rows3, ScatterChart, Grid3x3, Layers,
} from 'lucide-react'

export type { MetricDef } from '@/lib/resourceChartCompute'

type ViewMode = 'overlay' | 'stacked' | 'correlation' | 'heatmap'

interface ResourceChartExplorerProps {
  samples: ResourceSample[]
  metrics: MetricDef[]
  onBrushRange?: (from: number, to: number) => void
  defaultEnabled?: string[]
  /** Externally-driven crosshair time (e.g. jumped-to from the Insights panel). */
  focusTimestamp?: number | null
  /** Taller chart for the full-screen explore sub-page. */
  tall?: boolean
}

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'raw', label: 'Raw' },
  { value: 'auto', label: 'Auto' },
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
]

const AGG_OPTIONS: { value: AggFn; label: string }[] = [
  { value: 'avg', label: 'Avg' },
  { value: 'max', label: 'Max' },
  { value: 'min', label: 'Min' },
  { value: 'last', label: 'Last' },
]

const SCALE_OPTIONS: { value: ScaleMode; label: string; hint: string }[] = [
  { value: 'absolute', label: 'Absolute', hint: 'Each metric keeps real units on independent Y-axes' },
  { value: 'normalized', label: 'Normalized', hint: "0–100% of each metric's range — best for shape correlation" },
  { value: 'indexed', label: 'Indexed', hint: '% change from period start — compare relative movement' },
]

const VIEW_OPTIONS: { value: ViewMode; label: string; icon: React.ReactNode }[] = [
  { value: 'overlay', label: 'Overlay', icon: <LineChart className="h-3 w-3" /> },
  { value: 'stacked', label: 'Stacked', icon: <Rows3 className="h-3 w-3" /> },
  { value: 'correlation', label: 'Correlate', icon: <ScatterChart className="h-3 w-3" /> },
  { value: 'heatmap', label: 'Heatmap', icon: <Grid3x3 className="h-3 w-3" /> },
]

export function ResourceChartExplorer({
  samples,
  metrics,
  onBrushRange,
  defaultEnabled = ['host.cpu', 'host.memory', 'motor.live'],
  focusTimestamp = null,
  tall = false,
}: ResourceChartExplorerProps) {
  const metricByKey = useMemo(() => Object.fromEntries(metrics.map((m) => [m.key, m])), [metrics])
  const initialEnabled = defaultEnabled.filter((k) => metricByKey[k])
  const [enabled, setEnabled] = useState<Set<string>>(new Set(initialEnabled.length ? initialEnabled : [metrics[0]?.key]))
  const [viewMode, setViewMode] = useState<ViewMode>('overlay')
  const [scaleMode, setScaleMode] = useState<ScaleMode>('normalized')
  const [granularity, setGranularity] = useState<Granularity>('auto')
  const [aggFn, setAggFn] = useState<AggFn>('avg')
  const [showAvg, setShowAvg] = useState(false)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [brush, setBrush] = useState<{ start: number; end: number } | null>(null)
  const [brushing, setBrushing] = useState<{ startX: number; currX: number } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [corrX, setCorrX] = useState('motor.live')
  const [corrY, setCorrY] = useState('host.cpu')
  const svgRef = useRef<SVGSVGElement>(null)

  const chartSamples = useMemo(
    () => bucketResourceSamples(samples, granularity, aggFn),
    [samples, granularity, aggFn],
  )

  const activeMetrics = useMemo(() => metrics.filter((m) => enabled.has(m.key)), [metrics, enabled])
  const timestamps = useMemo(() => chartSamples.map((s) => s.timestamp), [chartSamples])

  const focusIdx = useMemo(() => {
    if (focusTimestamp == null || chartSamples.length === 0) return null
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < timestamps.length; i++) {
      const d = Math.abs(timestamps[i] - focusTimestamp)
      if (d < bestDist) { bestDist = d; best = i }
    }
    return best
  }, [focusTimestamp, chartSamples.length, timestamps])

  const activeIdx = hoverIdx ?? focusIdx
  const insight = useMemo(
    () => (activeIdx != null ? analyzePoint(chartSamples, activeIdx) : null),
    [chartSamples, activeIdx],
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

  const H = tall ? 380 : 280
  const chartGeom = useMemo(() => ({ W: 720, H, pad: { l: 46, r: 46, t: 16, b: 24 } }), [H])
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
      setBrushing((b) => (b ? { ...b, currX: x } : null))
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

  function onPointerLeave() { if (!brushing) setHoverIdx(null) }

  const seriesData = useMemo(() => {
    return activeMetrics.map((m) => {
      const raw = chartSamples.map(m.extract)
      const scaled = scaleSeries(raw, scaleMode)
      return { ...m, raw, scaled: scaled.values, yMin: scaled.min, yMax: scaled.max, scaleUnit: scaled.unit }
    })
  }, [activeMetrics, chartSamples, scaleMode])

  if (samples.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <LineChart className="h-5 w-5 text-muted-foreground/20 mb-2" />
        <p className="text-xs text-muted-foreground">Not enough samples in this range</p>
        <p className="text-[11px] text-muted-foreground/50 mt-0.5">Widen the time range or wait for more telemetry</p>
      </div>
    )
  }

  return (
    <div className="space-y-0">
      {/* Toolbar row 1: metric chips + picker + view mode */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/30 px-3 py-2">
        {activeMetrics.map((m) => (
          <button key={m.key} onClick={() => toggleMetric(m.key)}
            className="group flex items-center gap-1 rounded border border-border/60 bg-muted/20 px-2 py-0.5 text-[11px] font-medium text-foreground">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
            {m.label}
            <X className="h-2.5 w-2.5 text-muted-foreground/40 group-hover:text-muted-foreground" />
          </button>
        ))}

        <MetricPicker
          metrics={metrics}
          enabled={enabled}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onToggle={toggleMetric}
        />

        <div className="h-4 w-px bg-border/30 mx-0.5" />

        <div className="flex rounded-md border border-border/40 overflow-hidden">
          {VIEW_OPTIONS.map((v) => (
            <Tooltip key={v.value}>
              <TooltipTrigger asChild>
                <button onClick={() => setViewMode(v.value)}
                  className={cn('flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium transition-colors',
                    viewMode === v.value ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                  {v.icon}<span className="hidden sm:inline">{v.label}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{v.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {(viewMode === 'overlay' || viewMode === 'stacked') && (
          <>
            <Select value={scaleMode} onValueChange={(v) => setScaleMode(v as ScaleMode)}>
              <SelectTrigger className="h-6 w-[104px] text-[10px] border-none bg-muted/15"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCALE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button onClick={() => setShowAvg((v) => !v)}
              className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', showAvg ? 'bg-muted/30 text-foreground' : 'text-muted-foreground/50')}>
              Avg
            </button>
          </>
        )}

        {onBrushRange && (viewMode === 'overlay') && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 ml-auto">
            <ZoomIn className="h-3 w-3" /> Shift+drag to zoom
          </span>
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

      {/* Chart body + inspector */}
      <div className="grid lg:grid-cols-[1fr_212px]">
        <div className="px-2 py-1 relative">
          {viewMode === 'stacked' ? (
            <div className="divide-y divide-border/15">
              {seriesData.map((s) => (
                <StackedLane key={s.key} series={s} height={tall ? 110 : 92} showAvg={showAvg} geom={chartGeom} />
              ))}
            </div>
          ) : viewMode === 'correlation' ? (
            <CorrelationView
              samples={chartSamples}
              metrics={metrics}
              enabled={[...enabled]}
              xKey={corrX}
              yKey={corrY}
              onXKey={setCorrX}
              onYKey={setCorrY}
              geom={chartGeom}
            />
          ) : viewMode === 'heatmap' ? (
            <HeatmapView series={seriesData} timestamps={timestamps} geom={chartGeom} />
          ) : (
            <svg ref={svgRef} viewBox={`0 0 ${chartGeom.W} ${chartGeom.H}`} className="w-full select-none touch-none"
              onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave}>
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <line key={f} x1={chartGeom.pad.l} x2={chartGeom.W - chartGeom.pad.r}
                  y1={chartGeom.pad.t + plotH * (1 - f)} y2={chartGeom.pad.t + plotH * (1 - f)}
                  className="stroke-border/10" strokeWidth={0.5} />
              ))}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                const idx = Math.round(f * (chartSamples.length - 1))
                return (
                  <text key={f} x={xAt(idx)} y={chartGeom.H - 5} textAnchor="middle" className="fill-muted-foreground text-[7px]">
                    {new Date(timestamps[idx]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </text>
                )
              })}
              {[...divergencePoints].map((i) => (
                <circle key={`div-${i}`} cx={xAt(i)} cy={chartGeom.pad.t + 6} r={2.5} className="fill-amber-400/80" />
              ))}
              {seriesData.map((s, si) => {
                const range = s.yMax - s.yMin || 1
                const pts = s.scaled.map((val, i) => ({
                  x: xAt(i),
                  y: chartGeom.pad.t + plotH - ((val - s.yMin) / range) * plotH,
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
                      <circle key={i} cx={p.x} cy={p.y} r={activeIdx === i ? 3.5 : 1.6} fill={s.color} opacity={activeIdx === i ? 1 : 0.65} />
                    ))}
                    {showAvg && (
                      <line x1={chartGeom.pad.l} x2={chartGeom.W - chartGeom.pad.r} y1={avgY} y2={avgY}
                        stroke={s.color} strokeWidth={0.5} strokeDasharray="4 3" opacity={0.35} />
                    )}
                    {[0, 0.5, 1].map((f) => {
                      const val = s.yMin + range * f
                      const y = chartGeom.pad.t + plotH * (1 - f)
                      const label = scaleMode === 'absolute'
                        ? `${round1(s.raw[Math.round(f * (s.raw.length - 1))])}${s.unit}`
                        : `${round1(val)}${s.scaleUnit}`
                      return (
                        <text key={f} x={axisX + offset} y={y + 3} textAnchor={anchor} fill={s.color} className="text-[7px]" opacity={0.55}>{label}</text>
                      )
                    })}
                  </g>
                )
              })}
              {activeIdx != null && activeIdx >= 0 && activeIdx < chartSamples.length && (
                <>
                  <line x1={xAt(activeIdx)} x2={xAt(activeIdx)} y1={chartGeom.pad.t} y2={chartGeom.pad.t + plotH}
                    className="stroke-foreground/25" strokeWidth={1} strokeDasharray="3 2" />
                  <circle cx={xAt(activeIdx)} cy={chartGeom.pad.t + 4} r={3.5} className="fill-none stroke-foreground/40" strokeWidth={1.5} />
                </>
              )}
              {brushing && (
                <rect x={Math.min(brushing.startX, brushing.currX)} y={chartGeom.pad.t}
                  width={Math.abs(brushing.currX - brushing.startX)} height={plotH}
                  className="fill-primary/10 stroke-primary/40" strokeWidth={1} />
              )}
              <rect x={chartGeom.pad.l} y={chartGeom.pad.t} width={plotW} height={plotH} fill="transparent" />
            </svg>
          )}

          {(viewMode === 'overlay' || viewMode === 'stacked') && (
            <p className="px-1 pb-1 text-[9px] text-muted-foreground/40">
              {SCALE_OPTIONS.find((o) => o.value === scaleMode)?.hint}
              {divergencePoints.size > 0 && (
                <span className="ml-2 text-amber-400/70">● {divergencePoints.size} divergence{divergencePoints.size > 1 ? 's' : ''}</span>
              )}
            </p>
          )}
        </div>

        <div className="border-t lg:border-t-0 lg:border-l border-border/30 px-3 py-2 min-h-[140px]">
          {insight ? (
            <PointInspector insight={insight} sample={chartSamples[insight.index]} metrics={activeMetrics} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-6 text-center">
              <CrosshairIcon className="h-4 w-4 text-muted-foreground/20 mb-1" />
              <p className="text-[10px] text-muted-foreground/40">Hover the chart to inspect</p>
              <p className="text-[9px] text-muted-foreground/30 mt-0.5">Shift+drag to zoom · use ＋ to overlay metrics</p>
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

/* ── Metric picker (section-grouped) ────────────────────────── */

function MetricPicker({ metrics, enabled, open, onOpenChange, onToggle }: {
  metrics: MetricDef[]
  enabled: Set<string>
  open: boolean
  onOpenChange: (v: boolean) => void
  onToggle: (key: string) => void
}) {
  const grouped = useMemo(() => metricsBySection().filter((g) => g.metrics.length > 0), [])
  void metrics
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px]">
          <Plus className="h-3 w-3" /> Metric
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0 max-h-[420px] overflow-y-auto">
        <div className="sticky top-0 z-10 border-b border-border/40 bg-popover px-3 py-2">
          <p className="text-xs font-semibold">Overlay metrics</p>
          <p className="text-[10px] text-muted-foreground">Correlate any signal across sections. <span className="text-amber-400">Active sessions</span> drives load.</p>
        </div>
        {grouped.map((g) => (
          <div key={g.section.key} className="px-2 py-1.5">
            <div className="flex items-center gap-1.5 px-1 pb-1">
              <Layers className="h-3 w-3 text-muted-foreground/40" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.section.label}</span>
              {(g.section.key === 'host' || g.section.key === 'motor') && (
                <span className="rounded bg-primary/10 px-1 text-[8px] font-semibold uppercase text-primary">Key</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-0.5">
              {g.metrics.map((m) => {
                const on = enabled.has(m.key)
                return (
                  <Tooltip key={m.key}>
                    <TooltipTrigger asChild>
                      <button onClick={() => onToggle(m.key)}
                        className={cn('flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] transition-colors',
                          on ? 'bg-muted/40 text-foreground' : 'text-muted-foreground hover:bg-muted/20')}>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: on ? m.color : 'transparent', border: `1.5px solid ${m.color}` }} />
                        <span className="truncate">{m.label}</span>
                      </button>
                    </TooltipTrigger>
                    {m.description && <TooltipContent className="max-w-[220px]">{m.description}</TooltipContent>}
                  </Tooltip>
                )
              })}
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/* ── Correlation (scatter) view ─────────────────────────────── */

function CorrelationView({ samples, metrics, enabled, xKey, yKey, onXKey, onYKey, geom }: {
  samples: ResourceSample[]
  metrics: MetricDef[]
  enabled: string[]
  xKey: string
  yKey: string
  onXKey: (k: string) => void
  onYKey: (k: string) => void
  geom: { W: number; H: number; pad: { l: number; r: number; t: number; b: number } }
}) {
  const metricByKey = useMemo(() => Object.fromEntries(metrics.map((m) => [m.key, m])), [metrics])
  const options = enabled.length >= 2 ? enabled : metrics.map((m) => m.key)
  const xM = metricByKey[xKey] ?? metrics[0]
  const yM = metricByKey[yKey] ?? metrics[1] ?? metrics[0]
  const plotW = geom.W - geom.pad.l - geom.pad.r
  const plotH = geom.H - geom.pad.t - geom.pad.b

  const pts = samples.map((s) => ({ x: xM.extract(s), y: yM.extract(s) }))
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const r = pearson(xs, ys)
  const xMin = Math.min(...xs), xMax = Math.max(...xs) || 1
  const yMin = Math.min(...ys), yMax = Math.max(...ys) || 1
  const xRange = xMax - xMin || 1
  const yRange = yMax - yMin || 1
  const sx = (x: number) => geom.pad.l + ((x - xMin) / xRange) * plotW
  const sy = (y: number) => geom.pad.t + plotH - ((y - yMin) / yRange) * plotH

  const rStrength = Math.abs(r)
  const rLabel = rStrength > 0.85 ? 'strong' : rStrength > 0.5 ? 'moderate' : rStrength > 0.2 ? 'weak' : 'none'
  const rColor = rStrength > 0.85 ? 'text-emerald-400' : rStrength > 0.5 ? 'text-amber-400' : 'text-muted-foreground'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-1 py-1">
        <AxisSelect label="Y" value={yM.key} options={options} metricByKey={metricByKey} onChange={onYKey} />
        <span className="text-[10px] text-muted-foreground/50">vs</span>
        <AxisSelect label="X" value={xM.key} options={options} metricByKey={metricByKey} onChange={onXKey} />
        <span className={cn('ml-auto text-[11px] font-semibold tabular-nums', rColor)}>
          r = {r.toFixed(2)} <span className="font-normal text-muted-foreground/60">({rLabel})</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${geom.W} ${geom.H}`} className="w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={`h${f}`} x1={geom.pad.l} x2={geom.W - geom.pad.r} y1={geom.pad.t + plotH * f} y2={geom.pad.t + plotH * f} className="stroke-border/10" strokeWidth={0.5} />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={`v${f}`} x1={geom.pad.l + plotW * f} x2={geom.pad.l + plotW * f} y1={geom.pad.t} y2={geom.pad.t + plotH} className="stroke-border/10" strokeWidth={0.5} />
        ))}
        {/* Points colored oldest→newest */}
        {pts.map((p, i) => {
          const t = pts.length > 1 ? i / (pts.length - 1) : 0
          return <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.4} fill={yM.color} opacity={0.25 + t * 0.6} />
        })}
        {/* Axis labels */}
        <text x={geom.pad.l} y={geom.H - 6} className="fill-muted-foreground text-[8px]">{round1(xMin)}{xM.unit}</text>
        <text x={geom.W - geom.pad.r} y={geom.H - 6} textAnchor="end" className="fill-muted-foreground text-[8px]">{round1(xMax)}{xM.unit}</text>
        <text x={geom.pad.l - 4} y={geom.pad.t + 6} textAnchor="end" className="fill-muted-foreground text-[8px]">{round1(yMax)}{yM.unit}</text>
        <text x={geom.pad.l - 4} y={geom.pad.t + plotH} textAnchor="end" className="fill-muted-foreground text-[8px]">{round1(yMin)}{yM.unit}</text>
        <text x={geom.pad.l + plotW / 2} y={geom.H - 1} textAnchor="middle" className="fill-muted-foreground/70 text-[8px]">{xM.label}</text>
      </svg>
      <p className="px-1 pb-1 text-[9px] text-muted-foreground/40">
        Each dot is one sample (faded = older). A tight diagonal cloud means {yM.label} scales linearly with {xM.label}; a fan or flat band reveals nonlinearity.
      </p>
    </div>
  )
}

function AxisSelect({ label, value, options, metricByKey, onChange }: {
  label: string; value: string; options: string[]; metricByKey: Record<string, MetricDef>; onChange: (k: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-semibold text-muted-foreground/60">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-6 w-[132px] text-[10px] border-border/40"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((k) => (
            <SelectItem key={k} value={k} className="text-xs">{metricByKey[k]?.label ?? k}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/* ── Heatmap view ───────────────────────────────────────────── */

function HeatmapView({ series, timestamps, geom }: {
  series: { key: string; label: string; color: string; raw: number[] }[]
  timestamps: number[]
  geom: { W: number; H: number; pad: { l: number; r: number; t: number; b: number } }
}) {
  const cols = timestamps.length
  const rowH = 22
  const labelW = 92
  const plotW = geom.W - labelW - 8
  const cellW = cols > 0 ? plotW / cols : plotW
  const height = series.length * rowH + 22

  return (
    <svg viewBox={`0 0 ${geom.W} ${height}`} className="w-full">
      {series.map((s, r) => {
        const min = Math.min(...s.raw)
        const max = Math.max(...s.raw)
        const range = max - min || 1
        const y = r * rowH
        return (
          <g key={s.key}>
            <text x={labelW - 6} y={y + rowH / 2 + 3} textAnchor="end" className="text-[9px]" fill={s.color}>{s.label}</text>
            {s.raw.map((val, i) => {
              const t = (val - min) / range
              return (
                <rect key={i} x={labelW + i * cellW} y={y + 2} width={Math.max(cellW, 0.8)} height={rowH - 4}
                  fill={s.color} opacity={0.12 + t * 0.8}>
                  <title>{`${s.label}: ${round1(val)} @ ${new Date(timestamps[i]).toLocaleTimeString()}`}</title>
                </rect>
              )
            })}
          </g>
        )
      })}
      {[0, 0.5, 1].map((f) => {
        const idx = Math.round(f * (cols - 1))
        if (idx < 0) return null
        return (
          <text key={f} x={labelW + idx * cellW} y={height - 4} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="fill-muted-foreground text-[7px]">
            {new Date(timestamps[idx]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </text>
        )
      })}
    </svg>
  )
}

/* ── Point inspector ────────────────────────────────────────── */

function PointInspector({ insight, sample, metrics }: {
  insight: NonNullable<ReturnType<typeof analyzePoint>>
  sample: ResourceSample | undefined
  metrics: MetricDef[]
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-medium text-muted-foreground tabular-nums">
        {new Date(insight.utc).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>

      {sample && metrics.map((m) => {
        const val = m.extract(sample)
        return (
          <div key={m.key} className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground min-w-0">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: m.color }} />
              <span className="truncate">{m.label}</span>
            </span>
            <span className="text-xs font-bold tabular-nums shrink-0">{round1(val)}{m.unit}</span>
          </div>
        )
      })}

      {(insight.liveSessions != null || insight.cpuPerSession != null) && (
        <div className="grid grid-cols-2 gap-1 pt-1 border-t border-border/20">
          {insight.liveSessions != null && (
            <Callout label="Sessions" value={String(insight.liveSessions)} delta={insight.liveDelta} />
          )}
          {insight.cpuPerSession != null && (
            <Callout label="CPU/sess" value={`${insight.cpuPerSession}%`} />
          )}
        </div>
      )}

      {insight.divergences.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border/20">
          {insight.divergences.map((d, i) => (
            <p key={i} className="flex items-start gap-1 text-[10px] text-amber-400/90 leading-tight">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" /> {d}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function Callout({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  return (
    <div className="rounded bg-muted/15 px-1.5 py-1">
      <p className="text-[8px] uppercase text-muted-foreground/50">{label}</p>
      <p className="text-[11px] font-bold tabular-nums">
        {value}
        {delta != null && delta !== 0 && (
          <span className={cn('ml-1 text-[9px]', delta > 0 ? 'text-amber-400' : 'text-emerald-400')}>
            {delta > 0 ? '+' : ''}{delta}
          </span>
        )}
      </p>
    </div>
  )
}

/* ── Stacked lane ───────────────────────────────────────────── */

function StackedLane({ series, height, showAvg, geom }: {
  series: { key: string; label: string; color: string; fill: string; unit: string; raw: number[]; scaled: number[]; yMin: number; yMax: number }
  height: number
  showAvg: boolean
  geom: { W: number; pad: { l: number; r: number; t: number; b: number } }
}) {
  const plotW = geom.W - geom.pad.l - geom.pad.r
  const plotH = height - geom.pad.t - geom.pad.b
  const range = series.yMax - series.yMin || 1
  const pts = series.scaled.map((val, i) => ({
    x: geom.pad.l + (i / (series.scaled.length - 1)) * plotW,
    y: geom.pad.t + plotH - ((val - series.yMin) / range) * plotH,
  }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${geom.pad.t + plotH} L${geom.pad.l},${geom.pad.t + plotH} Z`
  const avg = series.scaled.reduce((a, b) => a + b, 0) / series.scaled.length
  const avgY = geom.pad.t + plotH - ((avg - series.yMin) / range) * plotH

  return (
    <div className="px-1">
      <p className="text-[9px] font-medium mb-0" style={{ color: series.color }}>
        {series.label} <span className="text-muted-foreground/50 font-normal">· {round1(series.raw[series.raw.length - 1])}{series.unit}</span>
      </p>
      <svg viewBox={`0 0 ${geom.W} ${height}`} className="w-full">
        <path d={area} fill={series.fill} />
        <path d={line} fill="none" stroke={series.color} strokeWidth={1.5} />
        {showAvg && <line x1={geom.pad.l} x2={geom.W - geom.pad.r} y1={avgY} y2={avgY} stroke={series.color} strokeDasharray="3 3" opacity={0.3} />}
      </svg>
    </div>
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
