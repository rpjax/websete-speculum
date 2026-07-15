/**
 * Centralized route metadata registry.
 *
 * Every admin route declares its display label and optional parent path.
 * Dynamic segments (`:id`, `:connectionId`) are resolved at render time
 * via `resolveLabel`.
 *
 * Used by `<PageBreadcrumbs />` to build navigation trails automatically.
 */

export interface RouteEntry {
  /** Human-readable label shown in breadcrumbs */
  label: string
  /** Absolute parent path (omit for top-level admin pages) */
  parent?: string
}

const ROUTE_MAP: Record<string, RouteEntry> = {
  '/admin':                         { label: 'Dashboard' },
  '/admin/forwarding':              { label: 'Forwarding' },
  '/admin/capacity':                { label: 'Capacity & bridges' },
  '/admin/hosting':                 { label: 'Hosting' },
  '/admin/script-injection':        { label: 'Script injection' },
  '/admin/scripts':                 { label: 'Scripts' },
  '/admin/sessions':                { label: 'Sessions' },
  '/admin/sessions/:id':            { label: ':id', parent: '/admin/sessions' },
  '/admin/diagnostics':             { label: 'Diagnostics' },
  '/admin/diagnostics/health':      { label: 'Health', parent: '/admin/diagnostics' },
  '/admin/diagnostics/resources':   { label: 'Resources', parent: '/admin/diagnostics' },
  '/admin/diagnostics/activity':    { label: 'Activity', parent: '/admin/diagnostics' },
  '/admin/diagnostics/investigate': { label: 'Investigate', parent: '/admin/diagnostics' },
  '/admin/diagnostics/governance':  { label: 'Governance', parent: '/admin/diagnostics' },
  '/admin/diagnostics/timeline':    { label: 'Timeline', parent: '/admin/diagnostics' },
  '/admin/api-key':                 { label: 'API key' },
  '/admin/openapi':                 { label: 'OpenAPI' },
}

/**
 * Match a concrete path like `/admin/sessions/conn-abc` against
 * route patterns like `/admin/sessions/:id`.
 *
 * Returns the entry and a map of resolved params.
 */
export function resolveRoute(pathname: string): { entry: RouteEntry; params: Record<string, string> } | null {
  const segments = pathname.replace(/\/$/, '').split('/')

  for (const [pattern, entry] of Object.entries(ROUTE_MAP)) {
    const patSegments = pattern.split('/')
    if (patSegments.length !== segments.length) continue

    const params: Record<string, string> = {}
    let match = true
    for (let i = 0; i < patSegments.length; i++) {
      if (patSegments[i].startsWith(':')) {
        params[patSegments[i].slice(1)] = segments[i]
      } else if (patSegments[i] !== segments[i]) {
        match = false
        break
      }
    }
    if (match) return { entry, params }
  }
  return null
}

export interface BreadcrumbSegment {
  label: string
  to?: string
}

/**
 * Build a breadcrumb trail for a given pathname.
 *
 * Walks up the `parent` chain from the matched route, producing
 * an array from root → leaf. The leaf segment has no `to` (it's the
 * current page).
 *
 * @param labelOverrides - map of param name → display string,
 *   e.g. `{ id: 'Session AAAA-111' }` to replace `:id` in the label.
 */
export function buildBreadcrumbs(
  pathname: string,
  labelOverrides?: Record<string, string>,
): BreadcrumbSegment[] {
  const result: BreadcrumbSegment[] = []
  let current = pathname.replace(/\/$/, '')

  const visited = new Set<string>()

  while (current) {
    if (visited.has(current)) break
    visited.add(current)

    const resolved = resolveRoute(current)
    if (!resolved) break

    let label = resolved.entry.label
    // Replace `:param` references in label with overrides or raw values
    for (const [param, value] of Object.entries(resolved.params)) {
      if (label === `:${param}`) {
        label = labelOverrides?.[param] ?? value
      }
    }

    result.unshift({ label, to: result.length > 0 ? current : undefined })

    current = resolved.entry.parent ?? ''
  }

  return result
}
