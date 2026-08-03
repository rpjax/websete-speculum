import { describe, expect, it } from 'vitest'
import { W7S_PREFIX, isW7sPath, w7sPath } from './w7s'

describe('w7sPath', () => {
  it('prefixes relative control paths', () => {
    expect(w7sPath('/api/public/client-config')).toBe('/w7s/api/public/client-config')
    expect(w7sPath('/vhub')).toBe('/w7s/vhub')
    expect(w7sPath('/health/live')).toBe('/w7s/health/live')
  })

  it('is idempotent and leaves absolute URLs alone', () => {
    expect(w7sPath('/w7s/api/foo')).toBe('/w7s/api/foo')
    expect(w7sPath('https://example.com/api')).toBe('https://example.com/api')
  })
})

describe('isW7sPath', () => {
  it('detects the control-plane prefix', () => {
    expect(isW7sPath(W7S_PREFIX)).toBe(true)
    expect(isW7sPath('/w7s/admin')).toBe(true)
    expect(isW7sPath('/admin')).toBe(false)
    expect(isW7sPath('/')).toBe(false)
  })
})
