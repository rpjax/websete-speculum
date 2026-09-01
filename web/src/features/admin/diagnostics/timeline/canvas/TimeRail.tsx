import { useMemo } from 'react'
import { scaleTime } from 'd3-scale'

interface TimeRailProps {
  startMs: number
  endMs: number
  width: number
  playheadMs?: number | null
  /** Draw full-height vertical guides behind lanes (caller overlays). */
  showGuides?: boolean
}

/** Shared lane label gutter — keep overlays/tracks in sync. */
export const LANE_LABEL_W = 148

/** Minimum px between major tick labels to avoid overlap. */
const MIN_LABEL_GAP_PX = 72

export function useTimeScale(startMs: number, endMs: number, width: number) {
  return useMemo(
    () =>
      scaleTime()
        .domain([new Date(startMs), new Date(endMs)])
        .range([8, Math.max(8, width - 8)]),
    [startMs, endMs, width],
  )
}

export function msToX(
  scale: ReturnType<typeof scaleTime>,
  ms: number,
): number {
  return scale(new Date(ms)) as number
}

/** Pick a tick count that keeps labels readable for the available rail width. */
export function tickCountForWidth(width: number): number {
  if (width <= 0) return 2
  return Math.max(2, Math.min(8, Math.floor(width / MIN_LABEL_GAP_PX)))
}

function formatTick(t: Date, spanMs: number): string {
  if (spanMs <= 2 * 60_000) {
    return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  if (spanMs >= 24 * 60 * 60_000) {
    return t.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function TimeRail({ startMs, endMs, width, playheadMs }: TimeRailProps) {
  const scale = useTimeScale(startMs, endMs, width)
  const spanMs = Math.max(1, endMs - startMs)
  const ticks = useMemo(() => {
    const desired = tickCountForWidth(width)
    const raw = scale.ticks(desired)
    // Cull any leftover collisions (d3 can still return denser sets for time).
    const kept: Date[] = []
    let lastX = -Infinity
    for (const t of raw) {
      const x = scale(t) as number
      if (x - lastX < MIN_LABEL_GAP_PX * 0.85) continue
      kept.push(t)
      lastX = x
    }
    return kept.length > 0 ? kept : raw.slice(0, 1)
  }, [scale, width])

  if (width <= 0) return null

  return (
    <svg width={width} height={36} className="block text-muted-foreground" aria-hidden>
      <line x1={8} y1={28} x2={width - 8} y2={28} stroke="currentColor" strokeOpacity={0.3} />
      {ticks.map((t) => {
        const x = scale(t) as number
        return (
          <g key={t.getTime()}>
            <line x1={x} y1={24} x2={x} y2={32} stroke="currentColor" strokeOpacity={0.45} />
            <text
              x={x}
              y={16}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 10 }}
            >
              {formatTick(t, spanMs)}
            </text>
          </g>
        )
      })}
      {playheadMs != null && Number.isFinite(playheadMs) && (
        <line
          x1={scale(new Date(playheadMs)) as number}
          y1={0}
          x2={scale(new Date(playheadMs)) as number}
          y2={36}
          stroke="hsl(var(--primary))"
          strokeWidth={1.5}
        />
      )}
    </svg>
  )
}

/** Vertical guide lines aligned to the same tick set as TimeRail. */
export function TimeGrid({
  startMs,
  endMs,
  width,
  height,
}: {
  startMs: number
  endMs: number
  width: number
  height: number
}) {
  const scale = useTimeScale(startMs, endMs, width)
  const ticks = useMemo(() => {
    const desired = tickCountForWidth(width)
    const raw = scale.ticks(desired)
    const kept: Date[] = []
    let lastX = -Infinity
    for (const t of raw) {
      const x = scale(t) as number
      if (x - lastX < MIN_LABEL_GAP_PX * 0.85) continue
      kept.push(t)
      lastX = x
    }
    return kept
  }, [scale, width])

  if (width <= 0 || height <= 0) return null

  return (
    <svg
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0 text-foreground"
      aria-hidden
    >
      {ticks.map((t) => {
        const x = scale(t) as number
        return (
          <line
            key={t.getTime()}
            x1={x}
            y1={0}
            x2={x}
            y2={height}
            stroke="currentColor"
            strokeOpacity={0.28}
          />
        )
      })}
    </svg>
  )
}
