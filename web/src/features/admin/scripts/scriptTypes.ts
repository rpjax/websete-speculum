export type ScriptMeta = { id: string; name: string; sha256: string; size: number; uploadedAt: string; updatedAt?: string }
export type ScriptList = { items: ScriptMeta[]; total: number }
export type Scope = 'any' | 'pattern'
export type Match = 'exact' | 'any'
export type MatchType = 'exact' | 'prefix'
export type TargetRule = {
  domain: { scope: Scope; labels: Array<{ match: Match; value: string }> }
  path: { scope: Scope; matchType: MatchType; segments: Array<{ match: Match; value: string }> }
}
export type Injection = {
  source: { sourceType: 'stored' | 'remote'; storedScriptId: string | null; remoteUrl: string | null }
  position: 'headStart' | 'headEnd' | 'bodyStart' | 'bodyEnd'
  executionType: 'classic' | 'module'
  targetRules: TargetRule[]
}
export type ScriptingSection = { injections: Injection[]; [key: string]: unknown }

export const matchAllRule = (): TargetRule => ({
  domain: { scope: 'any', labels: [] },
  path: { scope: 'any', matchType: 'exact', segments: [] },
})

export const newInjection = (): Injection => ({
  source: { sourceType: 'stored', storedScriptId: null, remoteUrl: null },
  position: 'headEnd',
  executionType: 'classic',
  targetRules: [matchAllRule()],
})

const camel = (value: unknown) => String(value ?? '').replace(/^./, (letter) => letter.toLowerCase())
const scope = (value: unknown): Scope => camel(value) === 'pattern' ? 'pattern' : 'any'
const match = (value: unknown): Match => camel(value) === 'any' ? 'any' : 'exact'
const matchType = (value: unknown): MatchType => camel(value) === 'prefix' ? 'prefix' : 'exact'

export function normaliseSection(value: unknown): ScriptingSection {
  const section = value as { injections?: unknown[] } | null
  return {
    ...(section && typeof section === 'object' ? section : {}),
    injections: (section?.injections ?? []).map((entry): Injection => {
      const item = entry as Record<string, any>
      return {
        source: {
          sourceType: camel(item.source?.sourceType) === 'remote' ? 'remote' : 'stored',
          storedScriptId: item.source?.storedScriptId ?? null,
          remoteUrl: item.source?.remoteUrl ?? null,
        },
        position: (['headStart', 'headEnd', 'bodyStart', 'bodyEnd'].includes(camel(item.position)) ? camel(item.position) : 'headEnd') as Injection['position'],
        executionType: camel(item.executionType) === 'module' ? 'module' : 'classic',
        targetRules: (item.targetRules ?? []).map((rule: any): TargetRule => ({
          domain: { scope: scope(rule.domain?.scope), labels: (rule.domain?.labels ?? []).map((label: any) => ({ match: match(label.match), value: label.value ?? '' })) },
          path: { scope: scope(rule.path?.scope), matchType: matchType(rule.path?.matchType), segments: (rule.path?.segments ?? []).map((segment: any) => ({ match: match(segment.match), value: segment.value ?? '' })) },
        })),
      }
    }),
  }
}

export function sourceSummary(injection: Injection, scripts: ScriptMeta[] = []) {
  if (injection.source.sourceType === 'remote') return `Remote · ${injection.source.remoteUrl || 'No URL'}`
  return `Stored · ${scripts.find((script) => script.id === injection.source.storedScriptId)?.name ?? 'Missing library script'}`
}

export function rulesSummary(rules: TargetRule[]) {
  return rules.length === 1 && rules[0]?.domain.scope === 'any' && rules[0]?.path.scope === 'any'
    ? 'Match all pages'
    : `${rules.length} target rule${rules.length === 1 ? '' : 's'}`
}
