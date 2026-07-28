import { PanelBottomClose } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LabDebugTools, type LabDebugToolsProps } from './LabDebugTools'

interface LabDebugDockProps extends LabDebugToolsProps {
  onCollapse: () => void
  className?: string
}

/**
 * Session Lab debug dock. Parent owns split sizing so the canvas stays navigable.
 */
export function LabDebugDock({ onCollapse, className, ...tools }: LabDebugDockProps) {
  return (
    <aside
      className={
        className
        ?? 'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card'
      }
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-foreground">Debug tools</p>
          <p className="text-[11px] text-muted-foreground">
            Same session as the canvas — stream, Journal, config, wire.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={onCollapse}
          aria-label="Hide debug tools"
        >
          <PanelBottomClose className="h-3.5 w-3.5" />
          Hide
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <LabDebugTools {...tools} />
      </div>
    </aside>
  )
}
