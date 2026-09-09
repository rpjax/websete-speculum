/**
 * Classify, never filter (N-1). A dropped request is a question nobody can answer
 * later; a labelled one is evidence.
 */
const CHALLENGE = ['challenges.cloudflare.com', 'hcaptcha.com', 'recaptcha.net', 'gstatic.com/recaptcha', 'turnstile']
const TELEMETRY = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'facebook.net', 'facebook.com/tr',
  'segment.io', 'segment.com', 'mixpanel.com', 'amplitude.com', 'hotjar.com', 'clarity.ms',
  'sentry.io', 'newrelic.com', 'datadoghq.com', 'bugsnag.com',
]
const ASSET_TYPES = new Set(['image', 'font', 'stylesheet', 'script', 'media', 'manifest', 'texttrack'])

export function classify(url: string, resourceType: string, pageHost: string | null, contentType?: string): string {
  const host = safeHost(url)
  if (CHALLENGE.some((h) => url.includes(h))) return 'challenge'
  if (TELEMETRY.some((h) => url.includes(h))) return 'telemetry'
  if (resourceType === 'xhr' || resourceType === 'fetch') {
    if (contentType && !/json|xml|text|graphql/i.test(contentType) && ASSET_TYPES.has(resourceType)) return 'asset'
    return host && pageHost && host !== pageHost ? 'thirdparty' : 'api'
  }
  if (ASSET_TYPES.has(resourceType) || resourceType === 'document') {
    return host && pageHost && host !== pageHost ? 'thirdparty' : 'asset'
  }
  return host && pageHost && host !== pageHost ? 'thirdparty' : 'asset'
}

export function safeHost(url: string): string | null {
  try { return new URL(url).host } catch { return null }
}
