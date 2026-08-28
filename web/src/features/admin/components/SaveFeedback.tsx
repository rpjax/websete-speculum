import { CircleAlert, CircleCheck, CircleX } from 'lucide-react'
import { cn } from '@/lib/utils'

export function SaveFeedback({
  mode,
  message = 'Saved',
  fieldErrors = [],
  className,
}: {
  mode:
    | 'toast-success'
    | 'inline-error'
    | 'banner-error'
    | 'strip-success'
    | 'strip-error'
    | 'strip-neutral'
    | 'strip-warning'
  message?: string
  fieldErrors?: { path: string; message: string }[]
  className?: string
}) {
  if (mode === 'toast-success' || mode === 'strip-success') {
    return (
      <p
        role="status"
        className={cn(
          'flex items-center gap-1.5 text-success',
          mode === 'strip-success' ? 'justify-end text-xs' : 'gap-2 text-sm',
          className,
        )}
      >
        <CircleCheck className={mode === 'strip-success' ? 'h-3.5 w-3.5 shrink-0' : 'h-4 w-4 shrink-0'} />
        <span className="min-w-0 truncate">{message}</span>
      </p>
    )
  }

  if (mode === 'strip-neutral') {
    return (
      <p role="status" className={cn('text-xs text-muted-foreground sm:text-right', className)}>
        <span className="min-w-0 break-words">{message}</span>
      </p>
    )
  }

  if (mode === 'strip-warning') {
    return (
      <p
        role="status"
        className={cn('flex items-start justify-end gap-1.5 text-xs text-warning', className)}
      >
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words text-right">{message}</span>
      </p>
    )
  }

  if (mode === 'strip-error') {
    return (
      <p role="alert" className={cn('flex items-start justify-end gap-1.5 text-xs text-destructive', className)}>
        <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words text-right">{message}</span>
      </p>
    )
  }

  return (
    <div
      role="alert"
      className={cn('rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive', className)}
    >
      <div className="flex gap-2">
        <CircleX className="h-4 w-4 shrink-0" />
        {message}
      </div>
      {fieldErrors.length ? (
        <ul className="mt-2 list-disc pl-6">
          {fieldErrors.map((error) => (
            <li key={`${error.path}-${error.message}`}>{error.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
