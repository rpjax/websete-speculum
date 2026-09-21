import { safeHost } from '../recorder/classify.js'

/** Host substrings that are beacons / fraud / analytics — not product closure (parity.md §4). */
const NOISE_HOSTS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'google.com.br/ads',
  'analytics.google.com', 'stats.g.doubleclick.net', 'facebook.net', 'facebook.com/tr',
  'segment.io', 'segment.com', 'mixpanel.com', 'amplitude.com', 'hotjar.com', 'clarity.ms',
  'sentry.io', 'sentry.eneba.com', 'newrelic.com', 'datadoghq.com', 'bugsnag.com',
  'forter.com', 'nsureapi.com', 'fpnpmcdn.net', 'mx.eneba.com', 'metrics.eneba.com',
  'metrics.nsureapi.com', 'sdk-service.nsureapi.com', 'widget.trustpilot.com',
]

/** Stable key for deduplicating tape rows into one gap. */
export function gapDedupeKey(url: string, note?: string): string {
  if (url.startsWith('chrome-extension://')) return url.split('?')[0] ?? url
  const pq = /pq ([a-f0-9]{12})/i.exec(note ?? '')?.[1]
  if (pq) return `gql:pq:${pq}`
  try {
    const u = new URL(url, url.startsWith('/') ? 'http://local.invalid' : undefined)
    return `${u.origin}${u.pathname}`
  } catch {
    const q = url.indexOf('?')
    return q < 0 ? url : url.slice(0, q)
  }
}

export type ParityNoiseReason = 'extension' | 'telemetry' | 'local-metrics'

export function parityNoiseReason(url: string): ParityNoiseReason | null {
  if (url.startsWith('chrome-extension://')) return 'extension'
  if (url.startsWith('/metrics') || url.includes('/metrics/')) return 'local-metrics'
  try {
    const u = new URL(url, url.startsWith('/') ? 'http://127.0.0.1' : undefined)
    if (u.pathname.startsWith('/metrics')) return 'local-metrics'
    if (u.hostname === '127.0.0.1' && u.pathname.includes('/metrics')) return 'local-metrics'
  } catch { /* relative or malformed */ }
  const lower = url.toLowerCase()
  if (NOISE_HOSTS.some((h) => lower.includes(h))) return 'telemetry'
  const host = safeHost(url.startsWith('/') ? `http://local.invalid${url}` : url)
  if (host && NOISE_HOSTS.some((h) => host.includes(h.split('/')[0]!))) return 'telemetry'
  return null
}

export function isParityNoise(url: string): boolean {
  return parityNoiseReason(url) !== null
}
