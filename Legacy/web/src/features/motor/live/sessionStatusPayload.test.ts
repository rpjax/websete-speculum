import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncClientLocation } from '@/features/motor/mapping/syncClientLocation'

/**
 * MotorEngine.onSessionStatus reads `status.url` (camelCase).
 * Hub MessagePack must emit camelCase keys (see MotorHubMessagePack / SessionStatus).
 */
function readStatusUrl(status: Record<string, unknown>): string | undefined {
  const url = status.url
  return typeof url === 'string' ? url : undefined
}

describe('sessionStatusPayload → syncClientLocation contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('applies pushState when status arrives with camelCase url (wire contract)', () => {
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

  it('ignores PascalCase Url — client is camelCase-only by contract', () => {
    const url = readStatusUrl({ Url: 'http://speculum.localhost/nav/b?_w7s_nso=abc', TabCount: 1 })
    expect(url).toBeUndefined()
  })
})
