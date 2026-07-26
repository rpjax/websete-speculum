import { describe, expect, it } from 'vitest'
import {
  clientToFramePoint,
  containContentRect,
  parseClientNavigation,
  toClientAddressBar,
} from './sessionCoords'
import { decodeNavigationState, encodeNavigationState, looksLikeHost } from './nso'

describe('containContentRect', () => {
  it('letterboxes a wide frame in a tall box', () => {
    const rect = containContentRect(200, 200, 400, 200)
    expect(rect.drawW).toBe(200)
    expect(rect.drawH).toBe(100)
    expect(rect.offsetX).toBe(0)
    expect(rect.offsetY).toBe(50)
  })
})

describe('clientToFramePoint', () => {
  it('maps into the drawn content, not the letterbox', () => {
    const point = clientToFramePoint(
      100,
      100,
      { left: 0, top: 0, width: 200, height: 200 },
      400,
      200,
    )
    expect(point.x).toBe(200)
    expect(point.y).toBe(100)
  })
})

describe('looksLikeHost', () => {
  it('detects hosts vs path tokens', () => {
    expect(looksLikeHost('google.com')).toBe(true)
    expect(looksLikeHost('www.google.com')).toBe(true)
    expect(looksLikeHost('localhost')).toBe(true)
    expect(looksLikeHost('search')).toBe(false)
    expect(looksLikeHost('/search')).toBe(false)
  })
})

describe('parseClientNavigation', () => {
  it('splits path and query without NSO', () => {
    expect(parseClientNavigation('/search?q=1')).toEqual({ path: '/search', query: 'q=1' })
  })

  it('encodes absolute URLs via NSO', () => {
    const result = parseClientNavigation('https://google.com/search?q=1')
    expect(result.path).toBe('/search')
    expect(result.query).toContain('q=1')
    expect(result.query).toContain('_w7s_nso=')
    const nso = result.query.split('&').find((part) => part.startsWith('_w7s_nso='))
    expect(nso).toBeTruthy()
    const encoded = decodeURIComponent(nso!.slice('_w7s_nso='.length))
    expect(decodeNavigationState(encoded)).toBe('google.com')
  })

  it('encodes bare hosts via NSO', () => {
    const result = parseClientNavigation('google.com')
    expect(result.path).toBe('/')
    const nso = result.query.split('&').find((part) => part.startsWith('_w7s_nso='))
    expect(nso).toBeTruthy()
    const encoded = decodeURIComponent(nso!.slice('_w7s_nso='.length))
    expect(decodeNavigationState(encoded)).toBe('google.com')
  })
})

describe('encodeNavigationState', () => {
  it('round-trips host', () => {
    expect(decodeNavigationState(encodeNavigationState('WWW.Example.COM'))).toBe('www.example.com')
  })
})

describe('toClientAddressBar', () => {
  it('shows host+path for SyncUrl absolute targets', () => {
    expect(toClientAddressBar('https://example.com/search?q=1')).toBe('example.com/search?q=1')
    expect(toClientAddressBar('https://example.com/')).toBe('example.com/')
  })
})
