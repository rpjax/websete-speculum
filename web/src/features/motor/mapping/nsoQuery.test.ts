import { describe, expect, it } from 'vitest'

const NSO = '_w7s_nso'

/** Dev (unencrypted) NSO round-trip mirrors MotorUrlAdapter Base64 JSON `{h}`. */
function encodeDevNso(targetHost: string): string {
  const json = JSON.stringify({ h: targetHost })
  return btoa(json)
}

function decodeDevNso(param: string): { h: string } {
  return JSON.parse(atob(param)) as { h: string }
}

function buildClientUrl(origin: string, path: string, targetHost: string): string {
  const u = new URL(path, origin)
  u.searchParams.set(NSO, encodeDevNso(targetHost))
  return u.toString()
}

describe('NSO query param round-trip', () => {
  it('encodes and decodes target host', () => {
    const encoded = encodeDevNso('fixture.test')
    expect(decodeDevNso(encoded).h).toBe('fixture.test')
  })

  it('survives URLSearchParams', () => {
    const url = buildClientUrl('https://speculum.test', '/nav/b', 'www.fixture.test')
    const parsed = new URL(url)
    expect(parsed.searchParams.get(NSO)).toBeTruthy()
    expect(decodeDevNso(parsed.searchParams.get(NSO)!).h).toBe('www.fixture.test')
  })
})
