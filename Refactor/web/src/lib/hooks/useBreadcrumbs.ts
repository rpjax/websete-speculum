import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { buildBreadcrumbs, type BreadcrumbSegment } from '@/lib/routeMap'

/**
 * Builds breadcrumb segments for the current route.
 *
 * @param labelOverrides - map of route param names to human-readable labels.
 *   For example, `{ id: 'Session AAAA-111' }` replaces the raw `:id` segment.
 */
export function useBreadcrumbs(labelOverrides?: Record<string, string>): BreadcrumbSegment[] {
  const { pathname } = useLocation()
  return useMemo(
    () => buildBreadcrumbs(pathname, labelOverrides),
    [pathname, labelOverrides],
  )
}
