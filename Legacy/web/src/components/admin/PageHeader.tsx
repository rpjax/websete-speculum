import type { ReactNode } from 'react'
import { PageBreadcrumbs } from './PageBreadcrumbs'
import type { BreadcrumbSegment } from '@/lib/routeMap'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  /** Optional breadcrumb trail rendered above the title. */
  breadcrumbs?: BreadcrumbSegment[]
}

export function PageHeader({ title, description, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="mb-1">
            <PageBreadcrumbs items={breadcrumbs} />
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}
