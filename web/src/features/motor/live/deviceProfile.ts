import type { DeviceProfilePayload } from './types'

/** Mirrors Speculum.Api ViewportDimensions — keep in sync with sidecar Xvfb ceiling. */
export const SESSION_VIEWPORT = {
  defaultWidth: 1280,
  defaultHeight: 720,
  maxWidth: 4096,
  maxHeight: 2160,
} as const

/**
 * Normalize session size the same way the API does before create/resize,
 * so canvas→page coordinate mapping matches the remote viewport.
 */
export function normalizeSessionViewport(width: number, height: number): { w: number; h: number } {
  let w = width > 0 ? Math.round(width) : SESSION_VIEWPORT.defaultWidth
  let h = height > 0 ? Math.round(height) : SESSION_VIEWPORT.defaultHeight
  w = Math.min(SESSION_VIEWPORT.maxWidth, Math.max(1, w))
  h = Math.min(SESSION_VIEWPORT.maxHeight, Math.max(1, h))
  return { w, h }
}

/** Build a DeviceProfile from the local browser environment (capped DPR 1–2). */
export function detectDeviceProfile(): DeviceProfilePayload {
  const coarse = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches
  const hoverNone = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: none)').matches
  const maxTouch = typeof navigator !== 'undefined' ? (navigator.maxTouchPoints || 0) : 0
  const touch = coarse || maxTouch > 0

  // Prefer platform signals over CSS width — landscape phones often exceed 900px.
  let uaMobile = false
  try {
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
    if (typeof uaData?.mobile === 'boolean') uaMobile = uaData.mobile
    else if (typeof navigator !== 'undefined') {
      uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
    }
  } catch { /* ignore */ }

  const mobile = uaMobile || (touch && hoverNone)
  let dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  if (!Number.isFinite(dpr) || dpr < 1) dpr = 1
  if (dpr > 2) dpr = 2

  let orientation: string | undefined
  try {
    orientation = window.screen?.orientation?.type
  } catch { /* ignore */ }

  return {
    mobile,
    touch,
    deviceScaleFactor: dpr,
    maxTouchPoints: Math.min(10, maxTouch || (touch ? 5 : 0)),
    userAgentProfile: mobile ? 'mobile' : 'desktop',
    screenOrientation: orientation,
  }
}

/** True when the wire-relevant device fields are unchanged. */
export function deviceProfilesEqual(a: DeviceProfilePayload, b: DeviceProfilePayload): boolean {
  return a.mobile === b.mobile
    && a.touch === b.touch
    && a.deviceScaleFactor === b.deviceScaleFactor
    && a.maxTouchPoints === b.maxTouchPoints
    && a.userAgentProfile === b.userAgentProfile
    && a.screenOrientation === b.screenOrientation
}
