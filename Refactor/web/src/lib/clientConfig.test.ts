import { describe, it, expect, beforeEach } from 'vitest'
import {
  CLIENT_TOKEN_COOKIE,
  FALLBACK_SESSION_VIEWPORT_POLICY,
  clearClientToken,
  isPendingConfigError,
  loadClientToken,
  normalizeMirrorMode,
  readSessionViewportPolicy,
  requireOperationalSessionsConfig,
  saveClientToken,
  type ClientConfig,
} from '@/lib/clientConfig'

const baseConfig: ClientConfig = {
  schemaVersion: 1,
  operational: true,
  missing: [],
  nsoParamName: '_w7s_nso',
  navigation: { defaultTargetHost: 'www.example.com' },
  sessions: {
    detachedSessionTimeoutSeconds: 300,
    dataStreamTransport: 'webTransport',
    mirrorMode: 'videoStreaming',
    viewportPolicy: {
      minWidth: 100,
      minHeight: 100,
      maxWidth: 4096,
      maxHeight: 2160,
      defaultWidth: 1280,
      defaultHeight: 720,
    },
    screencastMaxEncodeScale: 2,
  },
  resourceManagement: { maxConcurrentSessions: 8 },
  hosting: { required: false, domains: [] },
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

  it('detects Pending config hub errors', () => {
    expect(isPendingConfigError(new Error('Pending config: mandatory settings incomplete (Navigation).'))).toBe(true)
    expect(isPendingConfigError(new Error('resize_busy'))).toBe(false)
  })
})

describe('pre-start session settings', () => {
  it('normalizes the wire mirror mode and defaults to video streaming', () => {
    expect(normalizeMirrorMode('domProjection')).toBe('domProjection')
    expect(normalizeMirrorMode('videoStreaming')).toBe('videoStreaming')
    expect(normalizeMirrorMode(undefined)).toBe('videoStreaming')
    expect(normalizeMirrorMode('nonsense')).toBe('videoStreaming')
  })

  it('reads the viewport policy from client-config', () => {
    const config: ClientConfig = {
      ...baseConfig,
      sessions: {
        ...baseConfig.sessions,
        viewportPolicy: {
          minWidth: 400,
          minHeight: 300,
          maxWidth: 2560,
          maxHeight: 1440,
          defaultWidth: 1024,
          defaultHeight: 768,
        },
      },
    }

    expect(readSessionViewportPolicy(config)).toEqual({
      minWidth: 400,
      minHeight: 300,
      maxWidth: 2560,
      maxHeight: 1440,
      defaultWidth: 1024,
      defaultHeight: 768,
    })
  })

  it('falls back per-bound when client-config is missing or partial', () => {
    expect(readSessionViewportPolicy(null)).toEqual(FALLBACK_SESSION_VIEWPORT_POLICY)

    const partial = {
      ...baseConfig,
      sessions: {
        ...baseConfig.sessions,
        viewportPolicy: { ...baseConfig.sessions.viewportPolicy, maxWidth: 0 },
      },
    } as ClientConfig

    expect(readSessionViewportPolicy(partial).maxWidth).toBe(
      FALLBACK_SESSION_VIEWPORT_POLICY.maxWidth,
    )
    expect(readSessionViewportPolicy(partial).minWidth).toBe(100)
  })

  it('requireOperationalSessionsConfig fails closed when operational fields are broken', () => {
    expect(() => requireOperationalSessionsConfig(baseConfig)).not.toThrow()
    expect(() =>
      requireOperationalSessionsConfig({
        ...baseConfig,
        sessions: { ...baseConfig.sessions, mirrorMode: 'nope' as 'videoStreaming' },
      }),
    ).toThrow(/mirrorMode/)
    expect(() =>
      requireOperationalSessionsConfig({ ...baseConfig, operational: false }),
    ).not.toThrow()
  })
})
