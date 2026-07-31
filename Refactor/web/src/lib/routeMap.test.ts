import { describe, it, expect } from 'vitest'
import { resolveRoute, buildBreadcrumbs } from './routeMap'

describe('resolveRoute', () => {
  it('matches a static top-level route', () => {
    const result = resolveRoute('/admin/sessions')
    expect(result).not.toBeNull()
    expect(result!.entry.label).toBe('Sessions')
    expect(result!.params).toEqual({})
  })

  it('matches a dynamic route and extracts params', () => {
    const result = resolveRoute('/admin/sessions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(result).not.toBeNull()
    expect(result!.entry.label).toBe(':sessionId')
    expect(result!.params).toEqual({ sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    expect(result!.entry.parent).toBe('/admin/sessions')
  })

  it('matches nested diagnostics routes', () => {
    const result = resolveRoute('/admin/diagnostics/timeline')
    expect(result).not.toBeNull()
    expect(result!.entry.label).toBe('Timeline')
    expect(result!.entry.parent).toBe('/admin/diagnostics')
  })

  it('matches host-resources wizard steps', () => {
    const preview = resolveRoute('/admin/host-resources/preview')
    expect(preview).not.toBeNull()
    expect(preview!.entry.label).toBe('Preview')
    expect(preview!.entry.parent).toBe('/admin/host-resources')
    expect(resolveRoute('/admin/host-resources/apply')!.entry.label).toBe('Apply')
  })

  it('matches profiles delete route', () => {
    const result = resolveRoute('/admin/profiles/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/delete')
    expect(result).not.toBeNull()
    expect(result!.entry.label).toBe('Delete')
  })

  it('returns null for unknown paths', () => {
    expect(resolveRoute('/admin/nonexistent')).toBeNull()
    expect(resolveRoute('/admin/api-key')).toBeNull()
    expect(resolveRoute('/random')).toBeNull()
  })

  it('strips trailing slashes', () => {
    const result = resolveRoute('/admin/sessions/')
    expect(result).not.toBeNull()
    expect(result!.entry.label).toBe('Sessions')
  })

  it('does not match when segment count differs', () => {
    expect(resolveRoute('/admin/sessions/abc/extra')).toBeNull()
  })
})

describe('buildBreadcrumbs', () => {
  it('builds a single segment for a top-level page', () => {
    const crumbs = buildBreadcrumbs('/admin/sessions')
    expect(crumbs).toEqual([{ label: 'Sessions' }])
  })

  it('builds parent → child for a nested page', () => {
    const crumbs = buildBreadcrumbs('/admin/diagnostics/timeline')
    expect(crumbs).toHaveLength(2)
    expect(crumbs[0]).toEqual({ label: 'Diagnostics', to: '/admin/diagnostics' })
    expect(crumbs[1]).toEqual({ label: 'Timeline' })
  })

  it('resolves dynamic param labels from overrides', () => {
    const crumbs = buildBreadcrumbs('/admin/sessions/conn-xyz', { sessionId: 'Session XYZ' })
    expect(crumbs).toHaveLength(2)
    expect(crumbs[0]).toEqual({ label: 'Sessions', to: '/admin/sessions' })
    expect(crumbs[1]).toEqual({ label: 'Session XYZ' })
  })

  it('falls back to raw param value when no override', () => {
    const crumbs = buildBreadcrumbs('/admin/sessions/conn-abc')
    expect(crumbs[1].label).toBe('conn-abc')
  })

  it('returns empty array for unrecognized path', () => {
    expect(buildBreadcrumbs('/unknown/path')).toEqual([])
  })

  it('leaf segment has no "to" property', () => {
    const crumbs = buildBreadcrumbs('/admin/diagnostics/timeline')
    expect(crumbs[crumbs.length - 1].to).toBeUndefined()
  })
})
