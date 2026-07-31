/**
 * Admin route metadata for breadcrumbs / command palette helpers.
 * Keep aligned with frontend/wireframe/ia-map.md.
 */

export interface RouteEntry {
  label: string
  parent?: string
}

const ROUTE_MAP: Record<string, RouteEntry> = {
  '/admin': { label: 'Home' },
  '/admin/sessions': { label: 'Sessions' },
  '/admin/sessions/:sessionId': { label: ':sessionId', parent: '/admin/sessions' },
  '/admin/profiles': { label: 'Profiles' },
  '/admin/profiles/:profileId': { label: ':profileId', parent: '/admin/profiles' },
  '/admin/profiles/:profileId/delete': { label: 'Delete', parent: '/admin/profiles/:profileId' },
  '/admin/scripts': { label: 'Scripts' },
  '/admin/scripts/upload': { label: 'Upload', parent: '/admin/scripts' },
  '/admin/scripts/injections/new': { label: 'Add injection', parent: '/admin/scripts' },
  '/admin/scripts/injections/:index/edit': { label: 'Edit injection', parent: '/admin/scripts' },
  '/admin/scripts/injections/:index/remove': { label: 'Remove injection', parent: '/admin/scripts' },
  '/admin/configurations': { label: 'Configurations' },
  '/admin/configurations/:section': { label: ':section', parent: '/admin/configurations' },
  '/admin/host-resources': { label: 'Host resources' },
  '/admin/host-resources/preview': { label: 'Preview', parent: '/admin/host-resources' },
  '/admin/host-resources/apply': { label: 'Apply', parent: '/admin/host-resources' },
  '/admin/diagnostics': { label: 'Diagnostics' },
  '/admin/diagnostics/health': { label: 'Health', parent: '/admin/diagnostics' },
  '/admin/diagnostics/timeline': { label: 'Timeline', parent: '/admin/diagnostics' },
  '/admin/diagnostics/investigate': { label: 'Investigate', parent: '/admin/diagnostics' },
  '/admin/diagnostics/governance': { label: 'Governance', parent: '/admin/diagnostics' },
  '/admin/change-password': { label: 'Change password' },
}

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
    for (const [param, value] of Object.entries(resolved.params)) {
      if (label === `:${param}`) {
        label = labelOverrides?.[param] ?? value
      }
    }

    result.unshift({ label, to: result.length > 0 ? current : undefined })

    const parent = resolved.entry.parent
    if (!parent) break
    current = parent.replace(/:([A-Za-z]+)/g, (_, key: string) => resolved.params[key] ?? _)
  }

  return result
}
