import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Sparkline } from '@/features/sessions/lab/Sparkline'
import type { SessionStatus } from '@/lib/speculum'
import type { LabStats } from './useLabSession'

interface LabTelemetryPanelProps {
  stats: LabStats
  status: SessionStatus | null
  live: boolean
}

const FPS_HISTORY = 40

function Metric({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function LabTelemetryPanel({ stats, status, live }: LabTelemetryPanelProps) {
  const [fpsHistory, setFpsHistory] = useState<number[]>([])
  const lastFramesRef = useRef(0)

  useEffect(() => {
    if (stats.frames === lastFramesRef.current) {
      return
    }
    lastFramesRef.current = stats.frames
    setFpsHistory((previous) => [...previous, stats.fps].slice(-FPS_HISTORY))
  }, [stats.fps, stats.frames])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{stats.fps.toFixed(1)}</span>
          <span className="text-xs text-muted-foreground">frames/s</span>
        </div>
        <Sparkline
          data={fpsHistory}
          width={160}
          height={32}
          showFill
          label="Frames per second"
          valueFormatter={(value) => `${value.toFixed(1)} fps`}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric
          label="Frames"
          value={String(stats.frames)}
          hint={stats.staleFrames > 0 ? `${stats.staleFrames} stale dropped` : 'in sequence'}
        />
        <Metric
          label="Frame size"
          value={stats.lastFrameBytes ? `${(stats.lastFrameBytes / 1024).toFixed(1)} KB` : '—'}
          hint={stats.throughputKbps ? `${stats.throughputKbps} kbit/s` : undefined}
        />
        <Metric
          label="Relay lag"
          value={stats.relayLagMs == null ? '—' : `${stats.relayLagMs} ms`}
          hint="API receipt → paint"
        />
        <Metric
          label="Input → frame"
          value={stats.inputToFrameMs == null ? '—' : `${stats.inputToFrameMs} ms`}
          hint={stats.lastInputType ? `last: ${stats.lastInputType}` : 'no input yet'}
        />
        <Metric label="Inputs sent" value={String(stats.inputsSent)} />
        <Metric
          label="Sequence"
          value={stats.lastSequence < 0 ? '—' : String(stats.lastSequence)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant={live ? 'success' : 'muted'}>
          {live ? 'data plane open' : 'data plane closed'}
        </Badge>
        <Badge variant="muted">{stats.notifications} notifications</Badge>
        <Badge variant="muted">{stats.consoleMessages} console</Badge>
      </div>

      {status ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-border p-3 text-xs">
          <dt className="text-muted-foreground">Tabs</dt>
          <dd className={status.tabCount === 1 ? 'tabular-nums' : 'text-destructive tabular-nums'}>
            {status.tabCount}
          </dd>
          <dt className="text-muted-foreground">Logical</dt>
          <dd className="tabular-nums">
            {status.width}×{status.height}
            {status.resizing ? ' (resizing)' : ''}
          </dd>
          <dt className="text-muted-foreground">Render</dt>
          <dd className="tabular-nums">
            {status.chromeWidth}×{status.chromeHeight}
          </dd>
          <dt className="text-muted-foreground">Display</dt>
          <dd className="tabular-nums">
            {status.displayWidth}×{status.displayHeight}
          </dd>
          <dt className="text-muted-foreground">Relay fps</dt>
          <dd className="tabular-nums">{status.fps.toFixed(1)}</dd>
          <dt className="text-muted-foreground">Uptime</dt>
          <dd className="tabular-nums">{(status.uptimeMs / 1000).toFixed(1)} s</dd>
          <dt className="text-muted-foreground">JsBridge</dt>
          <dd>{status.jsBridgeEnabled ? 'enabled' : 'disabled'}</dd>
          <dt className="text-muted-foreground">Editing</dt>
          <dd>
            {status.editing?.focused
              ? `${status.editing.tagName ?? 'field'} (${status.editing.inputMode ?? 'text'})`
              : 'blurred'}
          </dd>
        </dl>
      ) : (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Poll Status to pull the unary snapshot (tab count, relay fps, JsBridge, editing focus).
        </p>
      )}
    </div>
  )
}
