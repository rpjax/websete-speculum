import { describe, expect, it } from 'vitest'
import {
  appendCacheBust,
  appendSessionAuth,
  appendSessionBindingQuery,
  isVirtualAssetUrl,
} from './sessionBindingAuth'
import { SessionAuthQueryParam } from './constants'

describe('appendSessionAuth', () => {
  it('stamps the reserved parameter on a virtual asset url', () => {
    expect(appendSessionAuth('/w7s/virtual-assets/cdn.site.com/a.css', 'tok')).toBe(
      '/w7s/virtual-assets/cdn.site.com/a.css?speculum-session-token=tok',
    )
  })

  it('preserves the mirrored site own token= instead of treating it as auth', () => {
    const out = appendSessionAuth('/w7s/virtual-assets/cdn.site.com/a.png?token=upstream', 'tok')
    expect(out).toBe(
      '/w7s/virtual-assets/cdn.site.com/a.png?token=upstream&speculum-session-token=tok',
    )
  })

  it('is idempotent — re-applying replaces the auth parameter, never duplicates it', () => {
    const once = appendSessionAuth('/w7s/virtual-assets/h/a.js?v=2', 'tok')
    const twice = appendSessionAuth(once, 'tok2')
    expect(twice).toBe('/w7s/virtual-assets/h/a.js?v=2&speculum-session-token=tok2')
    expect(twice.match(/speculum-session-token=/g)).toHaveLength(1)
  })

  it('keeps upstream query encoding and order verbatim', () => {
    const out = appendSessionAuth('/w7s/virtual-assets/h/a?b=%2Fx%20y&a=1', 'tok')
    expect(out).toBe('/w7s/virtual-assets/h/a?b=%2Fx%20y&a=1&speculum-session-token=tok')
  })

  it('keeps the fragment after the query', () => {
    expect(appendSessionAuth('/w7s/virtual-assets/h/s.svg#icon', 'tok')).toBe(
      '/w7s/virtual-assets/h/s.svg?speculum-session-token=tok#icon',
    )
  })

  it('absolutizes against the api origin when one is configured', () => {
    expect(appendSessionAuth('/w7s/virtual-blob/abc', 'tok', 'https://api.local/')).toBe(
      'https://api.local/w7s/virtual-blob/abc?speculum-session-token=tok',
    )
  })

  it('leaves non-virtual urls and empty tokens alone', () => {
    expect(appendSessionAuth('/w7s/api/public/client-config', 'tok')).toBe(
      '/w7s/api/public/client-config',
    )
    expect(appendSessionAuth('/w7s/virtual-assets/h/a.css', '')).toBe(
      '/w7s/virtual-assets/h/a.css',
    )
  })
})

describe('appendCacheBust', () => {
  it('uses the reserved buster so the server can strip it from the key', () => {
    expect(appendCacheBust('/w7s/virtual-assets/h/a.css?speculum-session-token=t', 7)).toBe(
      '/w7s/virtual-assets/h/a.css?speculum-session-token=t&speculum-cache-bust=7',
    )
  })

  it('replaces a previous buster', () => {
    const once = appendCacheBust('/w7s/virtual-assets/h/a.css', 1)
    expect(appendCacheBust(once, 2)).toBe('/w7s/virtual-assets/h/a.css?speculum-cache-bust=2')
  })
})

describe('appendSessionBindingQuery', () => {
  it('stamps sessionId and the reserved binding param — never generic token=', () => {
    const url = appendSessionBindingQuery(
      new URL('https://api.local/w7s/vtransport'),
      '00000000-0000-0000-0000-000000000001',
      'tok',
    )
    expect(url.searchParams.get('sessionId')).toBe('00000000-0000-0000-0000-000000000001')
    expect(url.searchParams.get(SessionAuthQueryParam)).toBe('tok')
    expect(url.searchParams.get('token')).toBeNull()
  })
})

describe('isVirtualAssetUrl', () => {
  it('matches the serve-plane prefixes only', () => {
    expect(isVirtualAssetUrl('/w7s/virtual-assets/h/a')).toBe(true)
    expect(isVirtualAssetUrl('/w7s/virtual-blob/1')).toBe(true)
    expect(isVirtualAssetUrl('/w7s/virtual-data/1')).toBe(true)
    expect(isVirtualAssetUrl('/w7s/vhub')).toBe(false)
  })
})
