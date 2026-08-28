/** Public HTTP wire prefix for the Speculum control plane (SPA + API + hubs). */
export const W7S_PREFIX = '/w7s'

/** True when pathname is exactly `/w7s` or under `/w7s/…`. */
export function isW7sPath(pathname: string): boolean {
  return pathname === W7S_PREFIX || pathname.startsWith(`${W7S_PREFIX}/`)
}

/**
 * Prefix a same-origin control path with `/w7s`.
 * Absolute http(s) URLs and already-prefixed paths are returned unchanged.
 */
export function w7sPath(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const normalized = path.startsWith('/') ? path : `/${path}`
  if (isW7sPath(normalized)) return normalized
  return `${W7S_PREFIX}${normalized}`
}
