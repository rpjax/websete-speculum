import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface SaveFeedbackStripProps {
  pending?: boolean
  message?: string | null
  error?: string | null
  onSave: () => void
  saveLabel?: string
  secondary?: ReactNode
}

export function SaveFeedbackStrip({
  pending,
  message,
  error,
  onSave,
  saveLabel = 'Save',
  secondary,
}: SaveFeedbackStripProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={pending} onClick={onSave}>
          {pending ? `${saveLabel}…` : saveLabel}
        </Button>
        {secondary}
      </div>
      {message && <p className="text-sm text-success" role="status">{message}</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  )
}
