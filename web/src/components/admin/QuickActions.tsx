import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Zap, ShieldCheck, Download, Cpu, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { diagnosticsApi } from '@/lib/diagnosticsApi'

interface QuickActionsProps {
  onRefresh: () => void
  className?: string
}

export function QuickActions({ onRefresh, className }: QuickActionsProps) {
  const [elevateOpen, setElevateOpen] = useState(false)
  const [elevateMinutes, setElevateMinutes] = useState(15)
  const [elevating, setElevating] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function handleElevate() {
    setElevating(true)
    try {
      await diagnosticsApi.elevate(elevateMinutes)
      setResult('BrowserQuery level elevated successfully')
      setElevateOpen(false)
      onRefresh()
    } catch (e: unknown) {
      setResult(e instanceof Error ? e.message : 'Elevation failed')
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
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Quick actions</span>
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setElevateOpen(true)}>
                <Zap className="h-3 w-3" /> Elevate
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Temporarily enable BrowserQuery for deep browser inspection</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void handleAutoProbe()}>
                <Cpu className="h-3 w-3" /> Auto probe
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Run a quick health probe on the first live session</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void handleExportAll()}>
                <Download className="h-3 w-3" /> Export all
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Download all diagnostic events as JSON</TooltipContent>
          </Tooltip>
        </div>
        {result && (
          <span className="text-[11px] text-muted-foreground animate-in fade-in">{result}</span>
        )}
      </div>

      <Dialog open={elevateOpen} onOpenChange={setElevateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Elevate BrowserQuery
            </DialogTitle>
            <DialogDescription className="leading-relaxed">
              This temporarily raises the BrowserQuery diagnostics level, enabling deep browser inspection
              including cookies, DOM snapshots, localStorage, and JavaScript evaluation for all sessions.
              The elevation automatically expires after the specified duration.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-3">
              <Label className="shrink-0 text-sm">Duration</Label>
              <Input
                type="number"
                value={elevateMinutes}
                onChange={(e) => setElevateMinutes(Number(e.target.value))}
                min={1}
                max={60}
                className="w-20 text-sm"
              />
              <span className="text-sm text-muted-foreground">minutes</span>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <p className="text-xs text-warning/80 leading-relaxed">
                Elevated mode increases CPU and memory usage on the sidecar browser processes. 
                Use the shortest duration needed for your investigation.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setElevateOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleElevate()} disabled={elevating} className="gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              {elevating ? 'Elevating…' : `Elevate for ${elevateMinutes}m`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
