import { describe, expect, it } from 'vitest'
import {
  allowHostAnyPath,
  buildUrlMatchRule,
  buildUrlMatchRuleFromModes,
  createMatchAllUrlRule,
  describeUrlMatchRule,
  hostMatchMode,
  isBareHost,
  isMatchAllUrlRules,
  normalizeUrlMatchRule,
  pathMatchMode,
  ruleHostField,
  rulePathField,
} from './urlMatchRules'

describe('urlMatchRules', () => {
  it('builds a host-any-path rule in camelCase', () => {
    const rule = allowHostAnyPath('www.google.com')
    expect(rule.domain.scope).toBe('pattern')
    expect(rule.domain.labels).toEqual([
      { match: 'exact', value: 'www' },
      { match: 'exact', value: 'google' },
      { match: 'exact', value: 'com' },
    ])
    expect(rule.path.scope).toBe('any')
    expect(describeUrlMatchRule(rule)).toBe('www.google.com · any path')
  })

  it('supports wildcard hosts and exact paths', () => {
    const rule = buildUrlMatchRule('*.example.com', '/app', true)
    expect(ruleHostField(rule)).toBe('*.example.com')
    expect(rulePathField(rule)).toBe('/app')
    expect(rule.path.matchType).toBe('exact')
  })

  it('normalizes PascalCase wire into camelCase', () => {
    const rule = normalizeUrlMatchRule({
      domain: {
        scope: 'Pattern',
        labels: [
          { match: 'Exact', value: 'example' },
          { match: 'Exact', value: 'com' },
        ],
      },
      path: { scope: 'Any', matchType: 'Prefix', segments: [] },
    })
    expect(rule.domain.scope).toBe('pattern')
    expect(rule.path.scope).toBe('any')
    expect(ruleHostField(rule)).toBe('example.com')
  })

  it('validates bare hosts', () => {
    expect(isBareHost('example.com')).toBe(true)
    expect(isBareHost('https://example.com')).toBe(false)
    expect(isBareHost('example.com/path')).toBe(false)
  })

  it('builds from explicit host/path modes', () => {
    const any = createMatchAllUrlRule()
    expect(isMatchAllUrlRules([any])).toBe(true)
    expect(hostMatchMode(any)).toBe('any')
    expect(pathMatchMode(any)).toBe('any')

    const sub = buildUrlMatchRuleFromModes('subdomains', 'example.com', 'prefix', '/app')
    expect(ruleHostField(sub)).toBe('*.example.com')
    expect(hostMatchMode(sub)).toBe('subdomains')
    expect(pathMatchMode(sub)).toBe('prefix')
    expect(describeUrlMatchRule(sub)).toBe('*.example.com · /app…')
  })
})
