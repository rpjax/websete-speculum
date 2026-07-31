import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SaveFeedback } from './SaveFeedback'

export function SaveFeedbackStrip({
  pending,
  message,
  error,
  onSave,
  saveLabel = 'Save',
  disabled,
  secondary,
  className,
}: {
  pending?: boolean
  message?: string | null
  error?: string | null
  onSave: () => void
  saveLabel?: string
  disabled?: boolean
  secondary?: ReactNode
  className?: string
}) {
  const busy = Boolean(pending)
  const saveDisabled = busy || Boolean(disabled)

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={saveDisabled} onClick={onSave} aria-busy={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {busy ? `${saveLabel}…` : saveLabel}
        </Button>
        {secondary}
      </div>

      <div className="min-w-0 flex-1 sm:text-right" aria-live="polite">
        {error ? (
          <SaveFeedback mode="strip-error" message={error} />
        ) : message ? (
          <SaveFeedback mode="strip-success" message={message} />
        ) : busy ? (
          <p role="status" className="text-xs text-muted-foreground sm:text-right">
            Applying changes…
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function SwitchField({
  id,
  label,
  helper,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  helper?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border/70 px-3 py-2.5">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {helper ? <p className="mt-0.5 text-xs text-muted-foreground">{helper}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export function ResourceGauge({
  label,
  usedLabel,
  percent,
}: {
  label: string
  usedLabel: string
  percent: number
}) {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/80">{usedLabel}</span>
      </div>
      <div className="h-2 rounded-full bg-muted/50">
        <div
          className={`h-full rounded-full ${clamped > 90 ? 'bg-destructive' : clamped > 70 ? 'bg-warning' : 'bg-primary'}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
