import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { BreadcrumbSegment } from '@/lib/routeMap'

interface PageBreadcrumbsProps {
  items: BreadcrumbSegment[]
}

/**
 * Unified breadcrumb trail used across all admin pages.
 *
 * Renders a chain of `Link` segments separated by chevrons.
 * The last segment (current page) is rendered as bold text with no link.
 */
export function PageBreadcrumbs({ items }: PageBreadcrumbsProps) {
  if (items.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      {items.map((segment, i) => {
        const isLast = i === items.length - 1
        return (
          <span key={`${segment.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />}
            {segment.to && !isLast ? (
              <Link
                to={segment.to}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {segment.label}
              </Link>
            ) : (
              <span className="font-semibold text-foreground">{segment.label}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
