import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncClientLocation } from './syncClientLocation'

describe('syncClientLocation', () => {
  beforeEach(() => {
    vi.stubGlobal('history', {
      pushState: vi.fn(),
    })
  })

  it('pushState when path differs and mirroring is off', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        host: 'speculum.localhost',
        hostname: 'speculum.localhost',
        pathname: '/',
        search: '',
        href: 'http://speculum.localhost/',
        protocol: 'http:',
      },
    })

    syncClientLocation('http://speculum.localhost/foo?q=1', false)

    expect(window.history.pushState).toHaveBeenCalledWith({}, '', '/foo?q=1')
  })

  it('full redirect when mirroring and host changes', () => {
    const hrefSetter = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        host: 'speculum.localhost',
        hostname: 'speculum.localhost',
        pathname: '/',
        search: '',
        href: 'http://speculum.localhost/',
        protocol: 'http:',
      },
    })
    Object.defineProperty(window.location, 'href', {
      configurable: true,
      set: hrefSetter,
      get: () => 'http://speculum.localhost/',
    })

    syncClientLocation('http://app.example.com/path', true)

    expect(hrefSetter).toHaveBeenCalledWith('http://app.example.com/path')
    expect(window.history.pushState).not.toHaveBeenCalled()
  })

  it('ignores invalid URLs', () => {
    expect(() => syncClientLocation('not-a-url', false)).not.toThrow()
  })
})
