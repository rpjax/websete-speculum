import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface HealthScoreGaugeProps {
  score: number
  size?: number
  label?: string
  className?: string
}

const THRESHOLDS = [
  { min: 80, textClass: 'text-emerald-400', label: 'Healthy' },
  { min: 50, textClass: 'text-amber-400', label: 'Attention' },
  { min: 0, textClass: 'text-red-400', label: 'Critical' },
]

export function computeHealthScore(metrics: {
  degraded: boolean
  eventsDropped: number
  overflowCount: number
  liveSessions: number
  storagePercent: number
  levelsOff: number
  totalLevels: number
}): number {
  let score = 100
  if (metrics.degraded) score -= 40
  if (metrics.eventsDropped > 0) score -= Math.min(20, metrics.eventsDropped * 2)
  if (metrics.overflowCount > 0) score -= Math.min(15, metrics.overflowCount * 5)
  if (metrics.storagePercent > 90) score -= 15
  else if (metrics.storagePercent > 70) score -= 5
  if (metrics.levelsOff > 0) score -= metrics.levelsOff * 3
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function HealthScoreGauge({ score, size = 90, label, className }: HealthScoreGaugeProps) {
  const threshold = THRESHOLDS.find((t) => score >= t.min) ?? THRESHOLDS[2]
  const radius = (size - 12) / 2
  const circumference = 2 * Math.PI * radius
  const arc = circumference * 0.75
  const filled = arc * (score / 100)
  const rotation = 135
  const cx = size / 2
  const cy = size / 2

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('flex flex-col items-center', className)}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* Background arc — uses currentColor via a colored group */}
            <g className="text-muted-foreground/20">
              <circle
                cx={cx} cy={cy} r={radius}
                fill="none" stroke="currentColor" strokeWidth={6}
                strokeLinecap="round"
                strokeDasharray={`${arc} ${circumference}`}
                transform={`rotate(${rotation} ${cx} ${cy})`}
              />
            </g>
            {/* Filled arc */}
            <g className={threshold.textClass}>
              <circle
                cx={cx} cy={cy} r={radius}
                fill="none" stroke="currentColor" strokeWidth={6}
                strokeLinecap="round"
                strokeDasharray={`${filled} ${circumference}`}
                transform={`rotate(${rotation} ${cx} ${cy})`}
                className="transition-all duration-700"
              />
            </g>
            {/* Score text */}
            <text x={cx} y={cy - size * 0.04} textAnchor="middle" dominantBaseline="middle"
              className="fill-foreground font-bold" style={{ fontSize: size * 0.3 }}>
              {score}
            </text>
            <text x={cx} y={cy + size * 0.2} textAnchor="middle"
              className="fill-muted-foreground font-medium"
              style={{ fontSize: size * 0.12 }}>
              {threshold.label}
            </text>
          </svg>
          {label && <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">{label}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        <p className="font-bold">Health Score: {score}/100</p>
        <p className="text-muted-foreground">
          {score >= 80 ? 'All systems operational — diagnostics pipeline is healthy.'
            : score >= 50 ? 'Some issues detected — review the alerts below.'
            : 'Critical issues — the system needs immediate attention.'}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
