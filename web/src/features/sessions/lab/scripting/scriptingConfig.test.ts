import { describe, expect, it } from 'vitest'
import {
  buildTargetRuleFromFields,
  createMatchAllTargetRule,
  describeTargetRule,
  formatTargetRules,
  isMatchAllTargetRules,
  normalizeScriptingConfiguration,
  parseTargetRules,
  targetRuleHostField,
  targetRulePathExact,
  targetRulePathField,
} from './scriptingConfig'

describe('scriptingConfig', () => {
  it('round-trips domain/path text including exact marker', () => {
    const rules = parseTargetRules('*.example.com /app\nwww.example.com /checkout$')
    expect(formatTargetRules(rules)).toBe('*.example.com /app\nwww.example.com /checkout$')
  })

  it('normalizes camelCase API enums after GET', () => {
    const normalized = normalizeScriptingConfiguration({
      injections: [{
        source: {
          sourceType: 'remote' as never,
          remoteUrl: 'https://cdn.example.com/a.js',
          storedScriptId: null,
        },
        executionType: 'module' as never,
        targetRules: [{
          domain: {
            scope: 'any' as never,
            labels: [],
          },
          path: {
            scope: 'pattern' as never,
            matchType: 'exact' as never,
            segments: [{ match: 'exact' as never, value: 'app' }],
          },
        }],
      }],
    })

    expect(normalized.injections[0].source.sourceType).toBe('Remote')
    expect(normalized.injections[0].executionType).toBe('Module')
    expect(normalized.injections[0].targetRules[0].domain.scope).toBe('Any')
    expect(normalized.injections[0].targetRules[0].path.matchType).toBe('Exact')
    expect(formatTargetRules(normalized.injections[0].targetRules)).toBe('* /app$')
  })

  it('defaults empty parse to explicit match-all', () => {
    expect(parseTargetRules('')).toEqual([{
      domain: { scope: 'Any', labels: [] },
      path: { scope: 'Any', matchType: 'Prefix', segments: [] },
    }])
  })

  it('builds and describes operator-facing host/path fields', () => {
    const rule = buildTargetRuleFromFields('*.Shop.Example.com', '/Cart', true)
    expect(targetRuleHostField(rule)).toBe('*.shop.example.com')
    expect(targetRulePathField(rule)).toBe('/Cart')
    expect(targetRulePathExact(rule)).toBe(true)
    expect(describeTargetRule(rule)).toBe('*.shop.example.com · exact /Cart')
    expect(isMatchAllTargetRules([createMatchAllTargetRule()])).toBe(true)
    expect(isMatchAllTargetRules([rule])).toBe(false)
  })
})
