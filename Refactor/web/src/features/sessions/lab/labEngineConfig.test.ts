import { describe, expect, it } from 'vitest'
import {
  formatAllowlistLines,
  parseAllowlistLines,
  parseHostingDomainLines,
} from './labEngineConfig'

describe('parseAllowlistLines', () => {
  it('emits Scope.Any when open', () => {
    expect(parseAllowlistLines('', true)).toEqual([
      { domain: { scope: 'Any', labels: [] } },
    ])
  })

  it('parses exact and wildcard hosts', () => {
    const rules = parseAllowlistLines('google.com\n*.olx.com.br', false)
    expect(rules).toHaveLength(2)
    expect(rules[0]?.domain.scope).toBe('Pattern')
    expect(rules[0]?.domain.labels.map((label) => label.value)).toEqual(['google', 'com'])
    expect(rules[1]?.domain.labels[0]?.match).toBe('Any')
    expect(rules[1]?.domain.labels.slice(1).map((label) => label.value)).toEqual([
      'olx',
      'com',
      'br',
    ])
  })

  it('preserves path match from previous rules', () => {
    const previous = [
      {
        domain: {
          scope: 'Pattern' as const,
          labels: [
            { match: 'Exact' as const, value: 'fixture' },
            { match: 'Exact' as const, value: 'test' },
          ],
        },
        path: { scope: 'Pattern' as const, segments: [{ match: 'Exact', value: 'api' }] },
      },
    ]
    const rules = parseAllowlistLines('fixture.test', false, previous)
    expect(rules[0]?.path).toEqual(previous[0]?.path)
  })
})

describe('formatAllowlistLines', () => {
  it('round-trips open allowlist', () => {
    expect(formatAllowlistLines([{ domain: { scope: 'Any', labels: [] } }])).toEqual({
      allowAny: true,
      text: '',
    })
  })
})

describe('parseHostingDomainLines', () => {
  it('parses mirroring suffix', () => {
    expect(parseHostingDomainLines('speculum.test +mirror')).toEqual([
      { domain: 'speculum.test', isSubdomainMirroringEnabled: true },
    ])
  })

  it('preserves certificate and dns challenge from previous domains', () => {
    expect(
      parseHostingDomainLines('speculum.test +mirror', [
        {
          domain: 'speculum.test',
          isSubdomainMirroringEnabled: false,
          certificateEmail: 'ops@speculum.test',
          dnsChallenge: { provider: 'Cloudflare' },
        },
      ]),
    ).toEqual([
      {
        domain: 'speculum.test',
        isSubdomainMirroringEnabled: true,
        certificateEmail: 'ops@speculum.test',
        dnsChallenge: { provider: 'Cloudflare' },
      },
    ])
  })
})
