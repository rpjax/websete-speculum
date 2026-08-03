/**
 * Admin route metadata for breadcrumbs / command palette helpers.
 * Keep aligned with frontend/wireframe/ia-map.md (paths under `/w7s`).
 */

import { W7S_PREFIX } from '@/lib/w7s'

export interface RouteEntry {
  label: string
  parent?: string
}

const A = `${W7S_PREFIX}/admin`

const ROUTE_MAP: Record<string, RouteEntry> = {
  [A]: { label: 'Home' },
  [`${A}/sessions`]: { label: 'Sessions' },
  [`${A}/sessions/:sessionId`]: { label: ':sessionId', parent: `${A}/sessions` },
  [`${A}/profiles`]: { label: 'Profiles' },
  [`${A}/profiles/:profileId`]: { label: ':profileId', parent: `${A}/profiles` },
  [`${A}/profiles/:profileId/delete`]: { label: 'Delete', parent: `${A}/profiles/:profileId` },
  [`${A}/scripts`]: { label: 'Scripts' },
  [`${A}/scripts/upload`]: { label: 'Upload', parent: `${A}/scripts` },
  [`${A}/scripts/injections/new`]: { label: 'Add injection', parent: `${A}/scripts` },
  [`${A}/scripts/injections/:index/edit`]: { label: 'Edit injection', parent: `${A}/scripts` },
  [`${A}/scripts/injections/:index/remove`]: { label: 'Remove injection', parent: `${A}/scripts` },
  [`${A}/configurations`]: { label: 'Configurations' },
  [`${A}/configurations/:section`]: { label: ':section', parent: `${A}/configurations` },
  [`${A}/host-resources`]: { label: 'Host resources' },
  [`${A}/host-resources/preview`]: { label: 'Preview', parent: `${A}/host-resources` },
  [`${A}/host-resources/apply`]: { label: 'Apply', parent: `${A}/host-resources` },
  // Hub redirects to Health — kept so breadcrumbs can show the Diagnostics section.
  [`${A}/diagnostics`]: { label: 'Diagnostics' },
  [`${A}/diagnostics/health`]: { label: 'Health', parent: `${A}/diagnostics` },
  [`${A}/diagnostics/resources`]: { label: 'Resources', parent: `${A}/diagnostics` },
  [`${A}/diagnostics/resources/explore`]: { label: 'Explore', parent: `${A}/diagnostics/resources` },
  [`${A}/diagnostics/signals`]: { label: 'Signals', parent: `${A}/diagnostics` },
  [`${A}/diagnostics/timeline`]: { label: 'Journal', parent: `${A}/diagnostics` },
  [`${A}/diagnostics/investigate`]: { label: 'Investigate', parent: `${A}/diagnostics` },
  [`${A}/diagnostics/reports`]: { label: 'Reports', parent: `${A}/diagnostics` },
  [`${A}/diagnostics/reports/new`]: { label: 'Generate report', parent: `${A}/diagnostics/reports` },
  [`${A}/diagnostics/reports/:reportId`]: { label: ':reportId', parent: `${A}/diagnostics/reports` },
  [`${A}/diagnostics/governance`]: { label: 'Governance', parent: `${A}/diagnostics` },
  [`${A}/change-password`]: { label: 'Change password' },
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
