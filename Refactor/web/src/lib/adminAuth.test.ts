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
    expect(safeReturnUrl('/admin/sessions')).toBe('/admin/sessions')
    expect(safeReturnUrl('/setup')).toBe('/setup')
    expect(safeReturnUrl('https://evil')).toBe('/admin')
    expect(safeReturnUrl('//evil')).toBe('/admin')
  })
})
