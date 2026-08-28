import { useEffect, useRef } from 'react'
import type { ScaleTime } from 'd3-scale'
import type { BeatCluster, NarrativeGranularity } from '../model/narrativeTypes'
import { LANE_LABEL_W, msToX, TimeGrid } from './TimeRail'

/** Fixed chart height — density should read as a chart, not a void filler. */
export const BEAT_RIBBON_H = 88
const BUCKETS = 36

interface BeatRibbonProps {
  clusters: BeatCluster[]
  scale: ScaleTime<number, number>
  width: number
  viewStart: number
  viewEnd: number
  granularity: NarrativeGranularity
  onSelectCluster: (cluster: BeatCluster) => void
}

/**
 * Beat density strip: background histogram of activity + clickable markers.
 * Clusters with N>1 render as •(N).
 */
export function BeatRibbon({
  clusters,
  scale,
  width,
  viewStart,
  viewEnd,
  granularity,
  onSelectCluster,
}: BeatRibbonProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const height = BEAT_RIBBON_H

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, width) * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (granularity === 'chapters' || width <= 0) return

    const inView = clusters.filter((c) => c.ms >= viewStart && c.ms <= viewEnd)
    const span = Math.max(1, viewEnd - viewStart)
    const counts = new Array<number>(BUCKETS).fill(0)
    const errCounts = new Array<number>(BUCKETS).fill(0)
    const warnCounts = new Array<number>(BUCKETS).fill(0)
    for (const c of inView) {
      const t = (c.ms - viewStart) / span
      const i = Math.min(BUCKETS - 1, Math.max(0, Math.floor(t * BUCKETS)))
      counts[i] += c.beats.length
      if (c.beats.some((b) => b.event.severity === 'Error')) errCounts[i] += 1
      else if (c.beats.some((b) => b.event.severity === 'Warning')) warnCounts[i] += 1
    }
    const max = Math.max(1, ...counts)
    const bucketW = width / BUCKETS
    const baseline = height - 8
    const usable = height - 28

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)'
    ctx.beginPath()
    ctx.moveTo(0, baseline)
    ctx.lineTo(width, baseline)
    ctx.stroke()

    for (let i = 0; i < BUCKETS; i++) {
      if (counts[i] <= 0) continue
      const h = Math.max(4, (counts[i] / max) * usable)
      const x = i * bucketW + 0.5
      const w = Math.max(2, bucketW - 1.5)
      const y = baseline - h
      if (errCounts[i] > 0) ctx.fillStyle = 'rgba(239, 68, 68, 0.52)'
      else if (warnCounts[i] > 0) ctx.fillStyle = 'rgba(245, 158, 11, 0.48)'
      else ctx.fillStyle = 'rgba(56, 189, 248, 0.48)'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle =
        errCounts[i] > 0
          ? 'rgba(248, 113, 113, 0.95)'
          : warnCounts[i] > 0
            ? 'rgba(251, 191, 36, 0.95)'
            : 'rgba(125, 211, 252, 0.95)'
      ctx.fillRect(x, y, w, 2)
    }

    const markerY = 12
    for (const cluster of inView) {
      const x = msToX(scale, cluster.ms)
      const n = cluster.beats.length
      const hasError = cluster.beats.some((b) => b.event.severity === 'Error')
      const hasWarn = cluster.beats.some((b) => b.event.severity === 'Warning')
      ctx.beginPath()
      ctx.fillStyle = hasError ? 'rgb(239 68 68)' : hasWarn ? 'rgb(245 158 11)' : 'rgb(125 211 252)'
      const r = n > 1 ? 5.5 : 2.75
      ctx.arc(x, markerY, r, 0, Math.PI * 2)
      ctx.fill()
      if (n > 1) {
        ctx.fillStyle = 'rgb(15 23 42)'
        ctx.font = 'bold 8px ui-sans-serif, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(n > 9 ? '9+' : n), x, markerY)
      }
    }
  }, [clusters, scale, width, height, granularity, viewStart, viewEnd])

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * width
    let best: BeatCluster | null = null
    let bestDist = 14
    for (const c of clusters) {
      if (c.ms < viewStart || c.ms > viewEnd) continue
      const cx = msToX(scale, c.ms)
      const d = Math.abs(cx - x)
      if (d < bestDist) {
        bestDist = d
        best = c
      }
    }
    if (best) onSelectCluster(best)
  }

  if (granularity === 'chapters') return null

  return (
    <div className="relative" style={{ height }}>
      <TimeGrid startMs={viewStart} endMs={viewEnd} width={width} height={height} />
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="relative z-[1] block cursor-pointer"
        style={{ width, height }}
        onClick={handleClick}
        aria-label="Beat density. Click a marker to open the cluster in the inspector."
      />
    </div>
  )
}

export function BeatRibbonRow(props: BeatRibbonProps) {
  if (props.granularity === 'chapters') return null
  return (
    <div className="flex min-w-0 shrink-0 border-t border-border/40">
      <div
        className="flex shrink-0 flex-col justify-center gap-0.5 border-r border-border/40 bg-muted/10 px-3 py-2"
        style={{ width: LANE_LABEL_W }}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Beats</span>
        <span className="text-[10px] leading-tight text-muted-foreground/80">Density over time</span>
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <BeatRibbon {...props} />
      </div>
    </div>
  )
}
