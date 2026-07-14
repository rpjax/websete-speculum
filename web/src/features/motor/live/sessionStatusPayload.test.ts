import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncClientLocation } from '@/features/motor/mapping/syncClientLocation'

/**
 * BUG B trap: MotorEngine.onSessionStatus reads `status.url` (camelCase).
 * MessagePack from the hub historically exposes PascalCase `Url` — sync never runs.
 * Hotfix plan must normalize keys OR configure camelCase MsgPack.
 */
function readStatusUrl(status: Record<string, unknown>): string | undefined {
  // Production path today (MotorEngine) — intentionally camelCase only:
  const url = status.url
  return typeof url === 'string' ? url : undefined
}

describe('sessionStatusPayload → syncClientLocation contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('applies pushState when status arrives with camelCase url (desired wire)', () => {
    vi.stubGlobal('window', {
      location: { pathname: '/', search: '', host: 'speculum.localhost', href: 'http://speculum.localhost/' },
      history: { pushState: vi.fn() },
    })

    const mapped = 'http://speculum.localhost/nav/b?_w7s_nso=abc'
    const url = readStatusUrl({ url: mapped, tabCount: 1 })
    expect(url).toBe(mapped)
    syncClientLocation(url!, false)
    expect(window.history.pushState).toHaveBeenCalled()
  })

  it('fails when only PascalCase Url is present (MsgPack trap — known red until hotfix)', () => {
    const url = readStatusUrl({ Url: 'http://speculum.localhost/nav/b?_w7s_nso=abc', TabCount: 1 })
    expect(
      url,
      'BUG B: status.Url (PascalCase) is invisible to MotorEngine status.url reader — client location never syncs',
    ).toBeTypeOf('string')
    expect(url).toContain('_w7s_nso')
  })
})
