import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Zap, Download, Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { diagnosticsApi } from '@/lib/diagnosticsApi'
import { ElevateSheet } from '@/features/admin/diagnostics/governance/ElevateSheet'

interface QuickActionsProps {
  onRefresh: () => void
  className?: string
  /** Ceiling for elevate duration; defaults to 30 when unknown. */
  elevateMaxMinutes?: number
}

export function QuickActions({ onRefresh, className, elevateMaxMinutes = 30 }: QuickActionsProps) {
  const [elevateOpen, setElevateOpen] = useState(false)
  const [elevating, setElevating] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function handleElevate(minutes: number) {
    setElevating(true)
    try {
      await diagnosticsApi.elevate({ minutes })
      setResult(`Browser Query elevated for ${minutes}m`)
      onRefresh()
    } catch (e: unknown) {
      setResult(e instanceof Error ? e.message : 'Elevation failed')
      throw e
    } finally {
      setElevating(false)
    }
  }

  async function handleAutoProbe() {
    try {
      const sessions = await diagnosticsApi.listSessions()
      if (sessions.sessions.length === 0) {
        setResult('No live sessions to probe')
        return
      }
      const first = sessions.sessions[0]
      await diagnosticsApi.runBrowserProbe(first.connectionId, { ops: ['process', 'tabs', 'resources'] })
      setResult(`Quick probe completed for ${first.connectionId.slice(0, 12)}…`)
      onRefresh()
    } catch (e: unknown) {
      setResult(e instanceof Error ? e.message : 'Probe failed')
    }
  }

  async function handleExportAll() {
    try {
      const events = await diagnosticsApi.listEvents({})
      const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `diagnostics-export-${new Date().toISOString().slice(0, 19)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setResult(`Exported ${events.length} events`)
    } catch (e: unknown) {
      setResult(e instanceof Error ? e.message : 'Export failed')
    }
  }

  return (
    <>
      <div className={cn('flex items-center gap-2', className)}>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Quick actions
        </span>
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setElevateOpen(true)}
              >
                <Zap className="h-3 w-3" /> Elevate
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              Temporarily unlock Browser Query for deep browser inspection
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => void handleAutoProbe()}
              >
                <Cpu className="h-3 w-3" /> Auto probe
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              Run a quick health probe on the first live session
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => void handleExportAll()}
              >
                <Download className="h-3 w-3" /> Export all
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Download all diagnostic events as JSON</TooltipContent>
          </Tooltip>
        </div>
        {result && (
          <span className="animate-in fade-in text-[11px] text-muted-foreground">{result}</span>
        )}
      </div>

      <ElevateSheet
        open={elevateOpen}
        onOpenChange={setElevateOpen}
        maxMinutes={elevateMaxMinutes}
        elevating={elevating}
        onConfirm={handleElevate}
      />
    </>
  )
}
