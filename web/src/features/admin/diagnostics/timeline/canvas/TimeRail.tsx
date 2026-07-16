import { useMemo } from 'react'
import { scaleTime } from 'd3-scale'

interface TimeRailProps {
  startMs: number
  endMs: number
  width: number
  playheadMs?: number | null
}

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

export function TimeRail({ startMs, endMs, width, playheadMs }: TimeRailProps) {
  const scale = useTimeScale(startMs, endMs, width)
  const ticks = scale.ticks(8)

  return (
    <svg width={width} height={28} className="block text-muted-foreground" aria-hidden>
      <line x1={8} y1={20} x2={width - 8} y2={20} stroke="currentColor" strokeOpacity={0.25} />
      {ticks.map((t) => {
        const x = scale(t)
        return (
          <g key={t.getTime()}>
            <line x1={x} y1={16} x2={x} y2={24} stroke="currentColor" strokeOpacity={0.4} />
            <text x={x} y={12} textAnchor="middle" className="fill-muted-foreground text-[9px]">
              {t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </text>
          </g>
        )
      })}
      {playheadMs != null && (
        <line
          x1={scale(new Date(playheadMs))}
          y1={0}
          x2={scale(new Date(playheadMs))}
          y2={28}
          stroke="hsl(var(--primary))"
          strokeWidth={1.5}
        />
      )}
    </svg>
  )
}
