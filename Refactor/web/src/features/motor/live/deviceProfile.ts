import type { DeviceProfilePayload } from './types'

export type { DeviceProfilePayload } from './types'

/** Bounds from Sessions.ViewportPolicy (StartSession hub response). */
export interface SessionViewportBounds {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  defaultWidth?: number
  defaultHeight?: number
}

/**
 * Mirrors Speculum.Api `appsettings` Sessions.ViewportPolicy defaults.
 * Prefer StartSession hub bounds in live sessions — do not treat this as product truth.
 */
export const DEFAULT_VIEWPORT_POLICY: SessionViewportBounds = {
  minWidth: 100,
  minHeight: 100,
  maxWidth: 4096,
  maxHeight: 2160,
  defaultWidth: 1280,
  defaultHeight: 720,
}

/**
 * Normalize session size the same way the API edge does at start
 * (fill non-positive → default, clamp to policy min..max).
 */
export function normalizeSessionViewport(
  width: number,
  height: number,
  policy: SessionViewportBounds,
): { w: number; h: number } {
  const defaultW = policy.defaultWidth ?? policy.minWidth
  const defaultH = policy.defaultHeight ?? policy.minHeight
  let w = width > 0 ? Math.round(width) : defaultW
  let h = height > 0 ? Math.round(height) : defaultH
  w = Math.min(policy.maxWidth, Math.max(policy.minWidth, w))
  h = Math.min(policy.maxHeight, Math.max(policy.minHeight, h))
  return { w, h }
}

/** Runtime resize candidate — reject outside policy (never snap). */
export function validateResizeViewport(
  width: number,
  height: number,
  policy: SessionViewportBounds,
):
  | { ok: true; w: number; h: number }
  | { ok: false; message: string } {
  const w = Math.round(width)
  const h = Math.round(height)
  if (
    !Number.isFinite(w)
    || !Number.isFinite(h)
    || w < policy.minWidth
    || h < policy.minHeight
  ) {
    return {
      ok: false,
      message: `viewport ${w}×${h} below minimum ${policy.minWidth}×${policy.minHeight}`,
    }
  }
  if (w > policy.maxWidth || h > policy.maxHeight) {
    return {
      ok: false,
      message: `viewport ${w}×${h} above maximum ${policy.maxWidth}×${policy.maxHeight}`,
    }
  }
  return { ok: true, w, h }
}

/**
 * True when Motor should treat the client as phone-like: suppress remote hover
 * mouse and prefer touch. Hybrid Windows (maxTouchPoints>0 + mouse) must stay false.
 */
export function isTouchPrimaryProfile(profile: Pick<DeviceProfilePayload, 'mobile'>): boolean {
  return !!profile.mobile
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
  // Capability only — many desktops report maxTouchPoints>0 (touchscreen / pen).
  const touchCapable = coarse || maxTouch > 0

  // Prefer platform signals over CSS width — landscape phones often exceed 900px.
  let uaMobile = false
  let uaTablet = false
  try {
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
    const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : ''
    if (typeof uaData?.mobile === 'boolean') uaMobile = uaData.mobile
    else uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
    uaTablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua)
      || (uaMobile === false && touchCapable && Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0) >= 600
        && Math.max(window.screen?.width ?? 0, window.screen?.height ?? 0) >= 900)
  } catch { /* ignore */ }

  // Phone-like only when UA says mobile phone, or primary pointer is coarse without hover.
  // Do NOT use maxTouchPoints alone — that killed desktop mouse on hybrid PCs.
  const phone = (uaMobile && !uaTablet) || (coarse && hoverNone && !uaTablet)
  const tablet = uaTablet || (!phone && coarse && hoverNone && maxTouch > 0)
  const mobile = phone || tablet
  const touch = touchCapable || mobile
  let dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  if (!Number.isFinite(dpr) || dpr < 1) dpr = 1
  if (dpr > 2) dpr = 2

  let orientation: string | undefined
  try {
    orientation = window.screen?.orientation?.type
  } catch { /* ignore */ }

  const deviceCategory: DeviceProfilePayload['deviceCategory'] = phone
    ? 'phone'
    : tablet
      ? 'tablet'
      : 'pc'

  return {
    mobile,
    touch,
    deviceScaleFactor: dpr,
    maxTouchPoints: Math.min(10, maxTouch || (touch ? 5 : 0)),
    userAgentProfile: deviceCategory === 'pc' ? 'desktop' : deviceCategory === 'phone' ? 'mobile' : 'tablet',
    deviceCategory,
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
    && a.deviceCategory === b.deviceCategory
    && a.screenOrientation === b.screenOrientation
}
