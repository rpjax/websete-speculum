/** CamelCase UrlMatchRule helpers for Configuration API (Navigation allowlist). */

export type UrlMatchRule = {
  domain: {
    scope: 'any' | 'pattern'
    labels: Array<{ match: 'exact' | 'any'; value: string }>
  }
  path: {
    scope: 'any' | 'pattern'
    matchType: 'exact' | 'prefix'
    segments: Array<{ match: 'exact' | 'any'; value: string }>
  }
}

const camel = (value: unknown) => String(value ?? '').replace(/^./, (letter) => letter.toLowerCase())
const asScope = (value: unknown): UrlMatchRule['domain']['scope'] =>
  camel(value) === 'pattern' ? 'pattern' : 'any'
const asMatch = (value: unknown): 'exact' | 'any' => (camel(value) === 'any' ? 'any' : 'exact')
const asMatchType = (value: unknown): 'exact' | 'prefix' =>
  camel(value) === 'prefix' ? 'prefix' : 'exact'

export function normalizeUrlMatchRule(rule: unknown): UrlMatchRule {
  const item = (rule && typeof rule === 'object' ? rule : {}) as Record<string, any>
  return {
    domain: {
      scope: asScope(item.domain?.scope),
      labels: (item.domain?.labels ?? []).map((label: any) => ({
        match: asMatch(label.match),
        value: label.value ?? '',
      })),
    },
    path: {
      scope: asScope(item.path?.scope),
      matchType: asMatchType(item.path?.matchType),
      segments: (item.path?.segments ?? []).map((segment: any) => ({
        match: asMatch(segment.match),
        value: segment.value ?? '',
      })),
    },
  }
}

export function normalizeUrlMatchRules(rules: unknown): UrlMatchRule[] {
  return Array.isArray(rules) ? rules.map(normalizeUrlMatchRule) : []
}

export function buildUrlMatchRule(hostRaw: string, pathRaw = '/', exactPath = false): UrlMatchRule {
  const domain = (hostRaw.trim() || '*').toLowerCase()
  let pathToken = pathRaw.trim() || '/'
  if (!pathToken.startsWith('/') && pathToken !== '*') pathToken = `/${pathToken}`
  const exact = exactPath || pathToken.endsWith('$')
  const normalizedPath = pathToken.endsWith('$') ? pathToken.slice(0, -1) : pathToken

  return {
    domain:
      domain === '*'
        ? { scope: 'any', labels: [] }
        : {
            scope: 'pattern',
            labels: domain
              .split('.')
              .filter(Boolean)
              .map((label) => ({
                match: label === '*' ? ('any' as const) : ('exact' as const),
                value: label === '*' ? '' : label,
              })),
          },
    path:
      normalizedPath === '/' || normalizedPath === '*'
        ? { scope: 'any', matchType: exact ? 'exact' : 'prefix', segments: [] }
        : {
            scope: 'pattern',
            matchType: exact ? 'exact' : 'prefix',
            segments: normalizedPath
              .split('/')
              .filter(Boolean)
              .map((segment) => ({
                match: segment === '*' ? ('any' as const) : ('exact' as const),
                value: segment === '*' ? '' : segment,
              })),
          },
  }
}

export function allowHostAnyPath(host: string): UrlMatchRule {
  return buildUrlMatchRule(host, '/', false)
}

export function createMatchAllUrlRule(): UrlMatchRule {
  return buildUrlMatchRule('*', '/', false)
}

export function isMatchAllUrlRule(rule: UrlMatchRule): boolean {
  return rule.domain.scope === 'any' && rule.path.scope === 'any'
}

export function isMatchAllUrlRules(rules: UrlMatchRule[]): boolean {
  return rules.length === 1 && isMatchAllUrlRule(rules[0]!)
}

export type HostMatchMode = 'any' | 'exact' | 'subdomains'
export type PathMatchMode = 'any' | 'prefix' | 'exact'

export function hostMatchMode(rule: UrlMatchRule): HostMatchMode {
  if (rule.domain.scope === 'any') return 'any'
  const host = ruleHostField(rule)
  return host.startsWith('*.') ? 'subdomains' : 'exact'
}

export function pathMatchMode(rule: UrlMatchRule): PathMatchMode {
  if (rule.path.scope === 'any') return 'any'
  return rulePathExact(rule) ? 'exact' : 'prefix'
}

/** Apex value for editing (strips leading *. when in subdomains mode). */
export function hostEditValue(rule: UrlMatchRule): string {
  const host = ruleHostField(rule)
  if (host === '*') return ''
  return host.startsWith('*.') ? host.slice(2) : host
}

export function buildUrlMatchRuleFromModes(
  hostMode: HostMatchMode,
  hostValue: string,
  pathMode: PathMatchMode,
  pathValue: string,
): UrlMatchRule {
  const trimmed = hostValue.trim().replace(/^\*\./, '')
  const host =
    hostMode === 'any' ? '*' : hostMode === 'subdomains' ? (trimmed ? `*.${trimmed}` : '*') : trimmed || '*'
  const path = pathMode === 'any' ? '/' : pathValue.trim() || '/'
  const exact = pathMode === 'exact'
  return buildUrlMatchRule(host, path, exact)
}

export function ruleHostField(rule: UrlMatchRule): string {
  if (rule.domain.scope === 'any') return '*'
  return rule.domain.labels.map((label) => (label.match === 'any' ? '*' : label.value)).join('.')
}

export function rulePathField(rule: UrlMatchRule): string {
  if (rule.path.scope === 'any') return '/'
  return `/${rule.path.segments.map((segment) => (segment.match === 'any' ? '*' : segment.value)).join('/')}`
}

export function rulePathExact(rule: UrlMatchRule): boolean {
  return rule.path.matchType === 'exact'
}

export function describeUrlMatchRule(rule: UrlMatchRule): string {
  const host = ruleHostField(rule)
  const path = rulePathField(rule)
  const exact = rulePathExact(rule)
  const hostLabel = host === '*' ? 'any host' : host
  const pathLabel = path === '/' ? 'any path' : exact ? `exact ${path}` : `${path}…`
  return `${hostLabel} · ${pathLabel}`
}

export function isBareHost(value: string) {
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value) && !/[/:]/.test(value)
}
