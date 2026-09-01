import type { ScriptTargetRule, ScriptingConfiguration, ScriptingInjectionEntry } from '@/lib/api'

export type ScriptExecutionType = ScriptingInjectionEntry['executionType']
export type ScriptSourceType = ScriptingInjectionEntry['source']['sourceType']

const EXECUTION_TYPES = new Set<ScriptExecutionType>(['Classic', 'Module'])
const SOURCE_TYPES = new Set<ScriptSourceType>(['Stored', 'Remote'])

function pascalEnum<T extends string>(value: string | null | undefined, allowed: Set<T>, fallback: T): T {
  if (!value) return fallback
  const normalized = value.trim()
  const pascal = normalized.length === 0
    ? fallback
    : (normalized[0].toUpperCase() + normalized.slice(1)) as T
  if (allowed.has(pascal)) return pascal
  const lower = normalized.toLowerCase()
  for (const candidate of allowed) {
    if (candidate.toLowerCase() === lower) return candidate
  }
  return fallback
}

function pascalMatch(value: string | null | undefined): 'Exact' | 'Any' {
  const lower = (value ?? '').trim().toLowerCase()
  return lower === 'any' ? 'Any' : 'Exact'
}

function pascalScope(value: string | null | undefined): 'Any' | 'Pattern' {
  const lower = (value ?? '').trim().toLowerCase()
  return lower === 'pattern' ? 'Pattern' : 'Any'
}

function pascalMatchType(value: string | null | undefined): 'Exact' | 'Prefix' {
  const lower = (value ?? '').trim().toLowerCase()
  return lower === 'exact' ? 'Exact' : 'Prefix'
}

export function normalizeScriptTargetRule(rule: ScriptTargetRule): ScriptTargetRule {
  return {
    domain: {
      scope: pascalScope(rule.domain?.scope),
      labels: (rule.domain?.labels ?? []).map((label) => ({
        match: pascalMatch(label.match),
        value: label.value ?? '',
      })),
    },
    path: {
      scope: pascalScope(rule.path?.scope),
      matchType: pascalMatchType(rule.path?.matchType),
      segments: (rule.path?.segments ?? []).map((segment) => ({
        match: pascalMatch(segment.match),
        value: segment.value ?? '',
      })),
    },
  }
}

export function normalizeScriptingConfiguration(
  config: ScriptingConfiguration | null | undefined,
): ScriptingConfiguration {
  return {
    injections: (config?.injections ?? []).map((injection) => ({
      source: {
        sourceType: pascalEnum(injection.source?.sourceType, SOURCE_TYPES, 'Stored'),
        storedScriptId: injection.source?.storedScriptId ?? null,
        remoteUrl: injection.source?.remoteUrl ?? null,
      },
      executionType: pascalEnum(injection.executionType, EXECUTION_TYPES, 'Classic'),
      targetRules: (injection.targetRules ?? []).map(normalizeScriptTargetRule),
    })),
  }
}

export function formatTargetRules(rules: ScriptTargetRule[]): string {
  if (!rules.length) {
    return '* /'
  }

  return rules.map((rule) => {
    const normalized = normalizeScriptTargetRule(rule)
    const domain = normalized.domain.scope === 'Any'
      ? '*'
      : normalized.domain.labels.map((label) => (label.match === 'Any' ? '*' : label.value)).join('.')
    const path = normalized.path.scope === 'Any'
      ? '/'
      : `/${normalized.path.segments.map((segment) => (segment.match === 'Any' ? '*' : segment.value)).join('/')}${normalized.path.matchType === 'Exact' ? '$' : ''}`
    return `${domain} ${path}`
  }).join('\n')
}

/** Single match-all rule (`* /`). */
export function createMatchAllTargetRule(): ScriptTargetRule {
  return {
    domain: { scope: 'Any', labels: [] },
    path: { scope: 'Any', matchType: 'Prefix', segments: [] },
  }
}

export function isMatchAllTargetRule(rule: ScriptTargetRule): boolean {
  const normalized = normalizeScriptTargetRule(rule)
  return normalized.domain.scope === 'Any' && normalized.path.scope === 'Any'
}

export function isMatchAllTargetRules(rules: ScriptTargetRule[]): boolean {
  return rules.length === 1 && isMatchAllTargetRule(rules[0]!)
}

/**
 * Build a rule from operator-facing host + path fields.
 * Host: `*` | `example.com` | `*.example.com`
 * Path: `/` | `/app` | `/checkout$` (or pass exactPath)
 */
export function buildTargetRuleFromFields(
  hostRaw: string,
  pathRaw: string,
  exactPath?: boolean,
): ScriptTargetRule {
  const domain = (hostRaw.trim() || '*').toLowerCase()
  let pathToken = pathRaw.trim() || '/'
  if (!pathToken.startsWith('/') && pathToken !== '*') {
    pathToken = `/${pathToken}`
  }
  const exact = exactPath ?? pathToken.endsWith('$')
  const normalizedPath = pathToken.endsWith('$')
    ? pathToken.slice(0, -1)
    : pathToken

  return {
    domain: domain === '*'
      ? { scope: 'Any', labels: [] }
      : {
          scope: 'Pattern',
          labels: domain.split('.').filter(Boolean).map((label) => ({
            match: (label === '*' ? 'Any' : 'Exact') as 'Exact' | 'Any',
            value: label === '*' ? '' : label,
          })),
        },
    path: normalizedPath === '/' || normalizedPath === '*'
      ? { scope: 'Any', matchType: exact ? 'Exact' : 'Prefix', segments: [] }
      : {
          scope: 'Pattern',
          matchType: exact ? 'Exact' : 'Prefix',
          segments: normalizedPath
            .split('/')
            .filter(Boolean)
            .map((segment) => ({
              match: (segment === '*' ? 'Any' : 'Exact') as 'Exact' | 'Any',
              value: segment === '*' ? '' : segment,
            })),
        },
  }
}

export function parseTargetRules(text: string): ScriptTargetRule[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return [createMatchAllTargetRule()]
  }

  return lines.map((line) => {
    const [rawDomain = '*', rawPath = '/'] = line.split(/\s+/, 2)
    return buildTargetRuleFromFields(rawDomain.trim(), rawPath.trim() || '/')
  })
}

/** Operator-facing host field for a rule. */
export function targetRuleHostField(rule: ScriptTargetRule): string {
  const normalized = normalizeScriptTargetRule(rule)
  if (normalized.domain.scope === 'Any') return '*'
  return normalized.domain.labels
    .map((label) => (label.match === 'Any' ? '*' : label.value))
    .join('.')
}

/** Operator-facing path field (without `$`; use targetRulePathExact). */
export function targetRulePathField(rule: ScriptTargetRule): string {
  const normalized = normalizeScriptTargetRule(rule)
  if (normalized.path.scope === 'Any') return '/'
  return `/${normalized.path.segments
    .map((segment) => (segment.match === 'Any' ? '*' : segment.value))
    .join('/')}`
}

export function targetRulePathExact(rule: ScriptTargetRule): boolean {
  return normalizeScriptTargetRule(rule).path.matchType === 'Exact'
}

/** Short human summary for chips / list rows. */
export function describeTargetRule(rule: ScriptTargetRule): string {
  const host = targetRuleHostField(rule)
  const path = targetRulePathField(rule)
  const exact = targetRulePathExact(rule)
  const hostLabel = host === '*' ? 'any host' : host
  const pathLabel = path === '/'
    ? 'any path'
    : exact
      ? `exact ${path}`
      : `${path}…`
  return `${hostLabel} · ${pathLabel}`
}
