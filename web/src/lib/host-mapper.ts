import type { ClientConfig } from '@/lib/session-id'

function getTargetApex(forwardingHost: string): string {
  const dot = forwardingHost.indexOf('.')
  return dot >= 0 ? forwardingHost.slice(dot + 1) : forwardingHost
}

export function mapTargetToClientUrl(
  targetUrl: string,
  config: ClientConfig,
): string {
  try {
    const target = new URL(targetUrl)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return targetUrl

    if (config.subdomainMirroringEnabled) {
      const motor = config.motorPublicDomain
      const apex = getTargetApex(config.forwardingHost)
      const host = target.hostname.toLowerCase()

      if (host === config.forwardingHost.toLowerCase() || host === apex) {
        return `${target.protocol}//${motor}${target.pathname}${target.search}`
      }

      const suffix = `.${apex}`
      if (host.endsWith(suffix)) {
        const sub = host.slice(0, -suffix.length)
        if (sub) return `${target.protocol}//${sub}.${motor}${target.pathname}${target.search}`
      }

      return `${target.protocol}//${motor}${target.pathname}${target.search}`
    }

    return `${target.protocol}//${config.motorPublicDomain}${target.pathname}${target.search}`
  } catch {
    return targetUrl
  }
}

export function syncClientLocation(mappedUrl: string): void {
  try {
    const next = new URL(mappedUrl)
    const current = window.location

    if (next.host !== current.host) {
      window.location.href = mappedUrl
      return
    }

    if (`${current.pathname}${current.search}` !== `${next.pathname}${next.search}`) {
      window.history.pushState({}, '', `${next.pathname}${next.search}`)
    }
  } catch {
    // ignore invalid URLs
  }
}
