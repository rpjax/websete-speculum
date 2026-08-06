import { SessionAuthQueryParam, SessionCacheBustQueryParam } from './constants'

/**
 * Live-session binding auth on the client.
 *
 * HTTP edges (virtual assets, Dom uploads, WT/WS dial) carry the binding token
 * in the reserved query parameter {@link SessionAuthQueryParam}. There is no
 * session-binding cookie — a mirrored site's own `token=` stays opaque upstream
 * query. Hub RPCs keep MessagePack `token` in the body (already explicit).
 *
 * Query surgery for asset URLs is done on the raw string on purpose —
 * `URL`/`URLSearchParams` normalize percent-encoding and parameter order, which
 * would change the virtual-asset key the sidecar materialized the body under.
 */

/** True for URLs served by the Dom Projection serve plane. */
export function isVirtualAssetUrl(url: string): boolean {
  return url.startsWith('/w7s/virtual-') || url.includes('/virtual-')
}

/**
 * Absolutize against the API origin and stamp the reserved auth parameter.
 * Idempotent: re-applying replaces the existing auth parameter instead of
 * appending a second one. Non-virtual URLs are returned untouched.
 */
export function appendSessionAuth(url: string, token: string, assetBaseUrl = ''): string {
  if (!url || !token) return url
  if (!isVirtualAssetUrl(url)) return url
  const base = assetBaseUrl.replace(/\/$/, '')
  const absolute = url.startsWith('http')
    ? url
    : `${base}${url.startsWith('/') ? url : `/${url}`}`
  return setReservedParam(absolute, SessionAuthQueryParam, token)
}

/**
 * Force a fresh fetch of an already-painted stylesheet. Uses a reserved name so
 * the server strips it before the key lookup — an ad-hoc buster would land in
 * the key and miss the materialized asset.
 */
export function appendCacheBust(url: string, value: string | number): string {
  if (!url) return url
  return setReservedParam(url, SessionCacheBustQueryParam, String(value))
}

/** Stamp sessionId + reserved binding token onto a URL (data-plane dial). */
export function appendSessionBindingQuery(
  url: URL,
  sessionId: string,
  token: string,
): URL {
  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set(SessionAuthQueryParam, token)
  return url
}

/** Replace-or-append `name=value`, preserving every other query part verbatim. */
function setReservedParam(url: string, name: string, value: string): string {
  const hashAt = url.indexOf('#')
  const fragment = hashAt >= 0 ? url.slice(hashAt) : ''
  const withoutFragment = hashAt >= 0 ? url.slice(0, hashAt) : url

  const queryAt = withoutFragment.indexOf('?')
  const path = queryAt >= 0 ? withoutFragment.slice(0, queryAt) : withoutFragment
  const rawQuery = queryAt >= 0 ? withoutFragment.slice(queryAt + 1) : ''

  const lowered = name.toLowerCase()
  const kept = rawQuery
    .split('&')
    .filter((part) => part.length > 0)
    .filter((part) => {
      const eq = part.indexOf('=')
      const key = eq >= 0 ? part.slice(0, eq) : part
      return key.toLowerCase() !== lowered
    })

  kept.push(`${name}=${encodeURIComponent(value)}`)
  return `${path}?${kept.join('&')}${fragment}`
}
