/** Canvas → remote page coordinates for object-contain letterboxing. */

import { looksLikeHost, withNavigationState } from './nso'

export function containContentRect(
  elementW: number,
  elementH: number,
  contentW: number,
  contentH: number,
): { offsetX: number; offsetY: number; drawW: number; drawH: number } {
  if (elementW <= 0 || elementH <= 0 || contentW <= 0 || contentH <= 0) {
    return { offsetX: 0, offsetY: 0, drawW: 0, drawH: 0 }
  }
  const scale = Math.min(elementW / contentW, elementH / contentH)
  const drawW = contentW * scale
  const drawH = contentH * scale
  return {
    offsetX: (elementW - drawW) / 2,
    offsetY: (elementH - drawH) / 2,
    drawW,
    drawH,
  }
}

/**
 * Maps a client pointer into session/frame pixel space for CSS `object-fill`
 * (canvas layout box == session viewport 1:1). No letterbox gutters.
 */
export function clientToFramePointFill(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  frameW: number,
  frameH: number,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || frameW <= 0 || frameH <= 0) {
    return null
  }
  const localX = clientX - rect.left
  const localY = clientY - rect.top
  if (localX < -0.5 || localY < -0.5 || localX > rect.width + 0.5 || localY > rect.height + 0.5) {
    return null
  }
  return {
    x: Math.round(Math.min(frameW - 1, Math.max(0, (localX / rect.width) * frameW))),
    y: Math.round(Math.min(frameH - 1, Math.max(0, (localY / rect.height) * frameH))),
  }
}

/**
 * Maps a client pointer into session/frame pixel space, accounting for
 * CSS `object-contain` letterboxing. Returns `null` when the hit is in the
 * letterbox gutter (outside the drawn frame) so callers can ignore it.
 */
export function clientToFramePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  frameW: number,
  frameH: number,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || frameW <= 0 || frameH <= 0) {
    return null
  }
  const { offsetX, offsetY, drawW, drawH } = containContentRect(
    rect.width,
    rect.height,
    frameW,
    frameH,
  )
  if (drawW <= 0 || drawH <= 0) {
    return null
  }
  const localX = clientX - rect.left - offsetX
  const localY = clientY - rect.top - offsetY
  // Small epsilon so edges of the drawn bitmap still hit.
  if (localX < -0.5 || localY < -0.5 || localX > drawW + 0.5 || localY > drawH + 0.5) {
    return null
  }
  return {
    x: Math.round(Math.min(frameW - 1, Math.max(0, (localX / drawW) * frameW))),
    y: Math.round(Math.min(frameH - 1, Math.max(0, (localY / drawH) * frameH))),
  }
}

export function shouldThrottleMove(nowMs: number, lastMoveMs: number, minIntervalMs = 16): boolean {
  return nowMs - lastMoveMs < minIntervalMs
}

export function isLocalBrowserShortcut(key: string, ctrlOrMeta: boolean): boolean {
  if (key === 'F12') return true
  if (ctrlOrMeta && ['r', 'l', 't', 'w', 'n'].includes(key.toLowerCase())) return true
  return false
}

export function normalizeWheelDeltas(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  frameW: number,
  frameH: number,
): { deltaX: number; deltaY: number } {
  let dX = deltaX
  let dY = deltaY
  if (deltaMode === 1) {
    dX *= 40
    dY *= 40
  } else if (deltaMode === 2) {
    dX *= frameW
    dY *= frameH
  }
  return { deltaX: dX, deltaY: dY }
}

/**
 * Splits an address-bar value into hub Navigate/Start path + query.
 * Absolute URLs and bare hosts become path/query + `_w7s_nso` (official wire).
 * Path-only input stays on the configured default target host (no NSO).
 */
export function parseClientNavigation(input: string): { path: string; query: string } {
  const trimmed = input.trim()
  if (!trimmed) {
    return { path: '/', query: '' }
  }

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed)
      const path = url.pathname || '/'
      const baseQuery = url.search.startsWith('?') ? url.search.slice(1) : url.search
      return {
        path,
        query: withNavigationState(baseQuery, url.hostname),
      }
    }
  } catch {
    // fall through
  }

  // Bare host or host/path (google.com, google.com/search?q=1)
  const hostPath = trimmed.match(/^([^/?#]+)(\/[^?#]*)?(\?[^#]*)?/)
  if (hostPath && looksLikeHost(hostPath[1] ?? '')) {
    const host = (hostPath[1] ?? '').toLowerCase()
    const path = hostPath[2] && hostPath[2].length > 0 ? hostPath[2] : '/'
    const baseQuery = hostPath[3]?.startsWith('?') ? hostPath[3].slice(1) : ''
    return {
      path,
      query: withNavigationState(baseQuery, host),
    }
  }

  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const q = withSlash.indexOf('?')
  if (q < 0) {
    return { path: withSlash, query: '' }
  }
  return {
    path: withSlash.slice(0, q) || '/',
    query: withSlash.slice(q + 1),
  }
}

/**
 * Address-bar display for SyncUrl.
 * Reverse host map is still ○ — show the absolute browser URL when present.
 */
export function toClientAddressBar(syncedUrl: string): string {
  const trimmed = syncedUrl.trim()
  if (!trimmed) {
    return '/'
  }
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed)
      return `${url.host}${url.pathname}${url.search}`
    }
  } catch {
    // fall through
  }
  const { path, query } = parseClientNavigation(trimmed)
  // Avoid echoing NSO in the bar when we only have path/query.
  const withoutNso = query
    .split('&')
    .filter((part) => part.length > 0 && !part.startsWith('_w7s_nso='))
    .join('&')
  return withoutNso ? `${path}?${withoutNso}` : path
}
