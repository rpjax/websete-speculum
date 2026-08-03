import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const widths = {
  overview: 'max-w-5xl',
  editor: 'max-w-3xl',
  narrow: 'max-w-2xl',
} as const

export function AdminPage({
  width = 'overview',
  children,
  footer,
  className,
}: {
  width?: keyof typeof widths
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  // Fill the shell main and scroll the body so a pinned save
  // strip never covers fields (Sessions was clipped by sticky-over-hidden).
  // Shell main uses overflow-y-auto as a safety net for pages without AdminPage.
  if (footer) {
    return (
      <div
        className={cn(
          'mx-auto flex h-full min-h-0 w-full flex-1 flex-col',
          widths[width],
          className,
        )}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pb-2">
          {children}
        </div>
        <div className="shrink-0 border-t border-border/60 bg-background pt-3">
          <div
            role="region"
            aria-label="Save actions"
            className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm"
          >
            {footer}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'mx-auto h-full min-h-0 w-full flex-1 space-y-4 overflow-y-auto overscroll-contain',
        widths[width],
        className,
      )}
    >
      {children}
    </div>
  )
}

export function DataCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
      {children}
    </div>
  )
}

export function MetaRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>
}

export function FieldGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>
}
