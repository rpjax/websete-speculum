/** Dev-only engine config backdoor (`/api/dev/engine-config`). */

export interface DevDomainLabel {
  match: 'Exact' | 'Any'
  value: string
}

export interface DevDomainPattern {
  scope: 'Any' | 'Pattern'
  labels: DevDomainLabel[]
}

export interface DevUrlMatchRule {
  domain: DevDomainPattern
  path?: { scope: 'Any' | 'Pattern'; segments?: unknown[] }
}

export interface DevHostingDomain {
  domain: string
  isSubdomainMirroringEnabled: boolean
  certificateEmail?: string | null
}

export interface DevEngineConfig {
  hosting: {
    defaultCertificateEmail: string
    domains: DevHostingDomain[]
  }
  navigation: {
    defaultTargetHost: string
    allowedMainFrameUrls: DevUrlMatchRule[]
  }
}

export const DEV_ENGINE_CONFIG_PATH = '/api/dev/engine-config'

export async function fetchDevEngineConfig(
  hubOrigin = '',
): Promise<DevEngineConfig | null> {
  const base = hubOrigin.trim().replace(/\/$/, '')
  const res = await fetch(`${base}${DEV_ENGINE_CONFIG_PATH}`, {
    headers: { Accept: 'application/json' },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    throw new Error(`GET ${DEV_ENGINE_CONFIG_PATH} failed (${res.status})`)
  }
  return (await res.json()) as DevEngineConfig
}

export async function putDevEngineConfig(
  body: DevEngineConfig,
  hubOrigin = '',
): Promise<DevEngineConfig> {
  const base = hubOrigin.trim().replace(/\/$/, '')
  const res = await fetch(`${base}${DEV_ENGINE_CONFIG_PATH}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `PUT ${DEV_ENGINE_CONFIG_PATH} failed (${res.status})`)
  }
  return (await res.json()) as DevEngineConfig
}

/** Serialize allowlist editor lines → Navigation.AllowedMainFrameUrls. */
export function parseAllowlistLines(text: string, allowAny: boolean): DevUrlMatchRule[] {
  if (allowAny) {
    return [{ domain: { scope: 'Any', labels: [] } }]
  }

  const rules: DevUrlMatchRule[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase()
    if (!line || line.startsWith('#')) {
      continue
    }
    if (line.startsWith('*.')) {
      const apex = line.slice(2)
      const labels = apex.split('.').filter(Boolean)
      if (labels.length === 0) {
        continue
      }
      rules.push({
        domain: {
          scope: 'Pattern',
          labels: [
            { match: 'Any', value: '' },
            ...labels.map((value) => ({ match: 'Exact' as const, value })),
          ],
        },
      })
      continue
    }

    const labels = line.split('.').filter(Boolean)
    if (labels.length === 0) {
      continue
    }
    rules.push({
      domain: {
        scope: 'Pattern',
        labels: labels.map((value) => ({ match: 'Exact' as const, value })),
      },
    })
  }
  return rules
}

export function formatAllowlistLines(rules: DevUrlMatchRule[]): {
  allowAny: boolean
  text: string
} {
  if (rules.some((rule) => rule.domain.scope === 'Any')) {
    return { allowAny: true, text: '' }
  }

  const lines: string[] = []
  for (const rule of rules) {
    const labels = rule.domain.labels ?? []
    if (labels.length === 0) {
      continue
    }
    if (labels[0]?.match === 'Any') {
      const apex = labels
        .slice(1)
        .map((label) => label.value)
        .filter(Boolean)
        .join('.')
      if (apex) {
        lines.push(`*.${apex}`)
      }
      continue
    }
    lines.push(labels.map((label) => label.value).filter(Boolean).join('.'))
  }
  return { allowAny: false, text: lines.join('\n') }
}

export function parseHostingDomainLines(text: string): DevHostingDomain[] {
  const domains: DevHostingDomain[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase()
    if (!line || line.startsWith('#')) {
      continue
    }
    const mirroring = line.endsWith(' mirroring') || line.endsWith(' +mirror')
    const domain = line
      .replace(/\s+\+?mirroring$/i, '')
      .replace(/\s+\+mirror$/i, '')
      .trim()
    if (!domain) {
      continue
    }
    domains.push({
      domain,
      isSubdomainMirroringEnabled: mirroring,
    })
  }
  return domains
}

export function formatHostingDomainLines(domains: DevHostingDomain[]): string {
  return domains
    .map((domain) =>
      domain.isSubdomainMirroringEnabled ? `${domain.domain} +mirror` : domain.domain,
    )
    .join('\n')
}
