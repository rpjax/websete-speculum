import { describe, expect, it, vi, afterEach } from 'vitest'
import { detectClientEnvironment } from './detectClientEnvironment'

describe('detectClientEnvironment', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads navigator language, timezone, and color scheme', () => {
    vi.stubGlobal('navigator', { language: 'pt-BR' })
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const env = detectClientEnvironment()
    expect(env.locale).toBe('pt-BR')
    expect(env.language).toBe('pt-BR')
    expect(env.timeZoneId).toBeTruthy()
    expect(env.colorScheme).toBe('dark')
  })
})
