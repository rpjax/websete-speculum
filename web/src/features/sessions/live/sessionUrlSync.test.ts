import { describe, expect, it } from 'vitest'
import { applySyncedBrowserUrl, resolveLabNavigateWire } from './sessionUrlSync'
import { decodeNavigationState, encodeNavigationState } from './nso'
import { parseClientNavigation } from './sessionCoords'

describe('applySyncedBrowserUrl', () => {
  it('builds display + path clientHref for raw browser URLs', () => {
    const before = `${window.location.pathname}${window.location.search}`
    const result = applySyncedBrowserUrl('https://www.google.com/search?q=1')
    expect(result.display).toBe('www.google.com/search?q=1')
    expect(result.clientHref).toBe('/search?q=1')
    expect(`${window.location.pathname}${window.location.search}`).toBe(before)
  })

  it('trusts server-projected SyncUrl with existing _w7s_nso', () => {
    const nso = encodeURIComponent(encodeNavigationState('cars'))
    const synced = `https://speculum.test/listing?q=1&_w7s_nso=${nso}`
    const result = applySyncedBrowserUrl(synced)
    expect(result.display).toBe('speculum.test/listing?q=1')
    expect(result.clientHref).toBe(`/listing?q=1&_w7s_nso=${nso}`)
    const encoded = new URL(result.clientHref, 'https://speculum.test').searchParams.get('_w7s_nso')
    expect(decodeNavigationState(decodeURIComponent(encoded!))).toBe('cars')
  })

  it('keeps mirrored SyncUrl path/query without inventing NSO', () => {
    const result = applySyncedBrowserUrl('https://cars.speculum.test/listing?q=1')
    expect(result.display).toBe('cars.speculum.test/listing?q=1')
    expect(result.clientHref).toBe('/listing?q=1')
  })
})

describe('resolveLabNavigateWire', () => {
  const nso = encodeURIComponent(encodeNavigationState('cars'))
  const navigateHref = `/listing?q=1&_w7s_nso=${nso}`
  const currentUrl = 'speculum.test/listing?q=1'

  it('uses navigateHref when the address bar matches the synced display', () => {
    expect(
      resolveLabNavigateWire({
        address: currentUrl,
        currentUrl,
        navigateHref,
      }),
    ).toBe(navigateHref)
  })

  it('uses the typed address when the user edited the bar', () => {
    expect(
      resolveLabNavigateWire({
        address: 'www.google.com/search?q=2',
        currentUrl,
        navigateHref,
      }),
    ).toBe('www.google.com/search?q=2')
  })

  it('falls back to address when navigateHref is missing', () => {
    expect(
      resolveLabNavigateWire({
        address: currentUrl,
        currentUrl,
        navigateHref: null,
      }),
    ).toBe(currentUrl)
  })

  it('preserves NSO when parseClientNavigation runs on the synced wire', () => {
    const wire = resolveLabNavigateWire({
      address: currentUrl,
      currentUrl,
      navigateHref,
    })
    const { path, query } = parseClientNavigation(wire)
    expect(path).toBe('/listing')
    expect(decodeNavigationState(decodeURIComponent(new URLSearchParams(query).get('_w7s_nso')!))).toBe(
      'cars',
    )
  })
})
