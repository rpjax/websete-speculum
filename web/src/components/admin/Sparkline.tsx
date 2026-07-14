import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  /** Tailwind text-color class, e.g. "text-primary". SVG uses currentColor. */
  colorClass?: string
  showFill?: boolean
  className?: string
  showDots?: boolean
  label?: string
  valueFormatter?: (v: number) => string
}

export function Sparkline({
  data,
  width = 100,
  height = 28,
  colorClass = 'text-primary',
  showFill = false,
  className,
  showDots = false,
  label,
  valueFormatter = (v) => String(v),
}: SparklineProps) {
  if (data.length < 2) return null

  const padding = 2
  const w = width - padding * 2
  const h = height - padding * 2
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((v, i) => ({
    x: padding + (i / (data.length - 1)) * w,
    y: padding + h - ((v - min) / range) * h,
    value: v,
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const fillD = showFill
    ? `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
    : undefined

  const last = data[data.length - 1]
  const prev = data[data.length - 2]
  const trend = last > prev ? 'up' : last < prev ? 'down' : 'flat'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('inline-flex items-center gap-1.5', colorClass, className)}>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
            {fillD && <path d={fillD} fill="currentColor" opacity={0.1} />}
            <path d={pathD} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            {showDots && points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={1.5} fill="currentColor" />
            ))}
            <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={2.5} fill="currentColor" />
          </svg>
          {label && (
            <span className="text-[10px] text-muted-foreground">
              {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <p className="font-medium">{label ?? 'Trend'}</p>
        <p className="text-muted-foreground">
          Latest: {valueFormatter(last)} · Min: {valueFormatter(Math.min(...data))} · Max: {valueFormatter(Math.max(...data))}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

interface SparkBarProps {
  data: { label: string; value: number; colorClass?: string }[]
  height?: number
  className?: string
}

export function SparkBar({ data, height = 24, className }: SparkBarProps) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div className={cn('flex items-end gap-0.5', className)} style={{ height }}>
      {data.map((d) => (
        <Tooltip key={d.label}>
          <TooltipTrigger asChild>
            <div
              className={cn('w-2.5 rounded-t-sm transition-all hover:opacity-80', d.colorClass ?? 'bg-primary')}
              style={{ height: `${Math.max((d.value / max) * 100, 4)}%` }}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {d.label}: <strong>{d.value}</strong>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
