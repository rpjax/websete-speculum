const COOKIE_NAME = 'speculum_client_token'

export interface ClientConfig {
  nsoParamName: string
  forwardingHost: string
  mirroringEnabled: boolean
  currentDomain?: string
  profiles: Array<{ domain: string; mirroringEnabled: boolean }>
}

let cachedConfig: ClientConfig | null = null

export function invalidateClientConfigCache(): void {
  cachedConfig = null
}

export async function fetchClientConfig(apiUrl: string, force = false): Promise<ClientConfig> {
  if (cachedConfig && !force) return cachedConfig
  const base = apiUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/api/public/client-config`)
  if (!res.ok) throw new Error('Failed to load client config')
  cachedConfig = await res.json() as ClientConfig
  return cachedConfig
}

function cookieDomain(config: ClientConfig): string | undefined {
  const host = window.location.hostname
  if (host === 'localhost' || host.endsWith('.localhost')) return host
  if (config.mirroringEnabled && config.currentDomain)
    return `.${config.currentDomain}`
  return undefined
}

export function loadClientToken(): string | null {
  const name = COOKIE_NAME + '='
  const parts = document.cookie.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith(name)) return trimmed.substring(name.length)
  }
  return null
}

export function saveClientToken(id: string, config: ClientConfig): void {
  const domain = cookieDomain(config)
  const secure = window.location.protocol === 'https:'
  let cookie = `${COOKIE_NAME}=${id}; Path=/; SameSite=Lax; Max-Age=31536000`
  if (domain) cookie += `; Domain=${domain}`
  if (secure) cookie += '; Secure'
  document.cookie = cookie
}

export function clearClientToken(config: ClientConfig): void {
  const domain = cookieDomain(config)
  let cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0`
  if (domain) cookie += `; Domain=${domain}`
  document.cookie = cookie
}
