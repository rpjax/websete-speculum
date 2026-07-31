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
  return (
    <div className={cn('mx-auto w-full space-y-4', widths[width], className)}>
      {children}
      {footer ? (
        <div className="sticky bottom-0 z-10 pt-3">
          <div
            role="region"
            aria-label="Save actions"
            className="rounded-lg border border-border bg-card/95 px-3 py-2 shadow-sm backdrop-blur-sm"
          >
            {footer}
          </div>
        </div>
      ) : null}
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
