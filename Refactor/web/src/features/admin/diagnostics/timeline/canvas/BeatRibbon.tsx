import { useEffect, useRef } from 'react'
import type { ScaleTime } from 'd3-scale'
import type { BeatCluster, NarrativeGranularity } from '../model/narrativeTypes'
import { msToX } from './TimeRail'

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
 * Dense beat ribbon — Canvas 2D for many markers; click hit-tests nearest cluster.
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = 28 * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, 28)

    if (granularity === 'chapters') return

    for (const cluster of clusters) {
      if (cluster.ms < viewStart || cluster.ms > viewEnd) continue
      const x = msToX(scale, cluster.ms)
      const n = cluster.beats.length
      const hasError = cluster.beats.some((b) => b.event.severity === 'Error')
      const hasWarn = cluster.beats.some((b) => b.event.severity === 'Warning')
      ctx.beginPath()
      ctx.fillStyle = hasError ? 'rgb(239 68 68)' : hasWarn ? 'rgb(245 158 11)' : 'rgb(56 189 248)'
      const r = n > 1 ? 5 : 2.5
      ctx.arc(x, 14, r, 0, Math.PI * 2)
      ctx.fill()
      if (n > 1) {
        ctx.fillStyle = 'rgb(255 255 255)'
        ctx.font = 'bold 8px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(n), x, 14)
      }
    }
  }, [clusters, scale, width, granularity, viewStart, viewEnd])

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    let best: BeatCluster | null = null
    let bestDist = 12
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
    <canvas
      ref={canvasRef}
      width={width}
      height={28}
      className="block w-full cursor-pointer"
      style={{ height: 28 }}
      onClick={handleClick}
      aria-label="Beat ribbon. Click a marker to open the cluster sheet."
    />
  )
}
