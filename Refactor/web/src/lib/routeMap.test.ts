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
    const result = resolveRoute('/admin/sessions/conn-abc-123')
    expect(result).not.toBeNull()
    expect(result!.entry.label).toBe(':id')
    expect(result!.params).toEqual({ id: 'conn-abc-123' })
    expect(result!.entry.parent).toBe('/admin/sessions')
  })

  it('matches nested diagnostics routes', () => {
    const result = resolveRoute('/admin/diagnostics/timeline')
    expect(result).not.toBeNull()
    expect(result!.entry.label).toBe('Timeline')
    expect(result!.entry.parent).toBe('/admin/diagnostics')
  })

  it('matches analysis route', () => {
    const result = resolveRoute('/admin/diagnostics/analysis')
    expect(result).not.toBeNull()
    expect(result!.entry.label).toBe('Analysis')
  })

  it('returns null for unknown paths', () => {
    expect(resolveRoute('/admin/nonexistent')).toBeNull()
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
    const crumbs = buildBreadcrumbs('/admin/sessions/conn-xyz', { id: 'Session XYZ' })
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
