import { describe, expect, it, beforeEach } from 'vitest'
import { clearAdminAuth, getAdminAuth, safeReturnUrl, setAdminAuth } from '@/lib/adminAuth'

describe('adminAuth', () => {
  beforeEach(() => {
    clearAdminAuth()
    sessionStorage.clear()
  })

  it('round-trips tokens through sessionStorage', () => {
    setAdminAuth({
      accessToken: 'a',
      accessExpiresAt: 't1',
      refreshToken: 'r',
      refreshExpiresAt: 't2',
      username: 'admin',
    })
    expect(getAdminAuth()?.username).toBe('admin')
    expect(getAdminAuth()?.accessToken).toBe('a')
  })

  it('allowlists returnUrl', () => {
    expect(safeReturnUrl('/w7s/admin/sessions')).toBe('/w7s/admin/sessions')
    expect(safeReturnUrl('/w7s/setup')).toBe('/w7s/setup')
    expect(safeReturnUrl('https://evil')).toBe('/w7s/admin')
    expect(safeReturnUrl('//evil')).toBe('/w7s/admin')
  })
})
