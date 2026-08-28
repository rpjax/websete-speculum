import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertTriangle, Zap } from 'lucide-react'

interface ElevateSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  maxMinutes: number
  elevating?: boolean
  onConfirm: (minutes: number) => Promise<void>
}

export function ElevateSheet({
  open,
  onOpenChange,
  maxMinutes,
  elevating,
  onConfirm,
}: ElevateSheetProps) {
  const ceiling = Math.max(1, Math.min(1440, maxMinutes || 30))
  const [minutes, setMinutes] = useState(Math.min(15, ceiling))
  const [localError, setLocalError] = useState<string | null>(null)

  async function handleConfirm() {
    setLocalError(null)
    const clamped = Math.max(1, Math.min(ceiling, minutes))
    try {
      await onConfirm(clamped)
      onOpenChange(false)
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : 'Elevation failed')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setLocalError(null)
        onOpenChange(next)
        if (next) setMinutes(Math.min(15, ceiling))
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Elevate Browser Query
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            Temporarily unlock Browser Query probes and Sidecar events for all live sessions.
            Elevation is a runtime overlay — it does not rewrite saved configuration, and it
            overrides Degraded for those domains until it expires.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-3">
            <Label className="shrink-0 text-sm">Duration</Label>
            <Input
              type="number"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              min={1}
              max={ceiling}
              className="w-20 text-sm"
            />
            <span className="text-sm text-muted-foreground">minutes (max {ceiling})</span>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <p className="text-xs text-warning/80 leading-relaxed">
              Elevated mode increases CPU and memory on sidecar browser processes.
              Use the shortest duration needed for your investigation.
            </p>
          </div>
          {localError && <p className="text-xs text-destructive">{localError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleConfirm()} disabled={elevating} className="gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            {elevating ? 'Elevating…' : `Elevate for ${Math.max(1, Math.min(ceiling, minutes))}m`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
