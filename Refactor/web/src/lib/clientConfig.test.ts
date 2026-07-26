import { describe, it, expect, beforeEach } from 'vitest'
import {
  CLIENT_TOKEN_COOKIE,
  clearClientToken,
  loadClientToken,
  saveClientToken,
  type ClientConfig,
} from '@/lib/clientConfig'

const baseConfig: ClientConfig = {
  nsoParamName: '_w7s_nso',
  forwardingHost: 'www.example.com',
  mirroringEnabled: false,
  profiles: [],
}

describe('clientConfig token cookie', () => {
  beforeEach(() => {
    document.cookie.split(';').forEach((c) => {
      const name = c.split('=')[0]?.trim()
      if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
    })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        hostname: 'localhost',
        protocol: 'http:',
        href: 'http://localhost/',
      },
    })
  })

  it('saves and loads client token', () => {
    saveClientToken('tok-abc', baseConfig)
    expect(document.cookie).toContain(`${CLIENT_TOKEN_COOKIE}=tok-abc`)
    expect(loadClientToken()).toBe('tok-abc')
  })

  it('clears client token', () => {
    saveClientToken('tok-abc', baseConfig)
    clearClientToken(baseConfig)
    expect(loadClientToken()).toBeNull()
  })
})
