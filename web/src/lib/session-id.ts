const COOKIE_NAME = 'speculum_client_token'

export interface ClientConfig {
  motorPublicDomain: string
  subdomainMirroringEnabled: boolean
  forwardingHost: string
}

let cachedConfig: ClientConfig | null = null

export async function fetchClientConfig(apiUrl: string): Promise<ClientConfig> {
  if (cachedConfig) return cachedConfig
  const res = await fetch(`${apiUrl}/api/public/client-config`)
  if (!res.ok) throw new Error('Failed to load client config')
  cachedConfig = await res.json() as ClientConfig
  return cachedConfig
}

function cookieDomain(config: ClientConfig): string | undefined {
  const host = window.location.hostname
  if (host === 'localhost' || host.endsWith('.localhost')) return host
  if (config.subdomainMirroringEnabled) return `.${config.motorPublicDomain}`
  return config.motorPublicDomain
}

export function loadClientToken(_config: ClientConfig): string | null {
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
