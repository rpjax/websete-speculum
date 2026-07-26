import { describe, expect, it } from 'vitest'
import { applySyncedBrowserUrl } from './sessionUrlSync'
import { decodeNavigationState } from './nso'

describe('applySyncedBrowserUrl', () => {
  it('builds display + NSO clientHref without mutating history', () => {
    const before = `${window.location.pathname}${window.location.search}`
    const result = applySyncedBrowserUrl('https://www.google.com/search?q=1')
    expect(result.display).toBe('www.google.com/search?q=1')
    expect(result.clientHref.startsWith('/search?')).toBe(true)
    expect(result.clientHref).toContain('_w7s_nso=')
    const nso = new URL(result.clientHref, 'https://speculum.test').searchParams.get('_w7s_nso')
    expect(decodeNavigationState(decodeURIComponent(nso!))).toBe('www.google.com')
    expect(`${window.location.pathname}${window.location.search}`).toBe(before)
  })
})
