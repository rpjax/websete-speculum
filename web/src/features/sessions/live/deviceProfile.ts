import type { DeviceProfilePayload } from '@/features/motor/live/types'

export type { DeviceProfilePayload } from '@/features/motor/live/types'

export {
  SESSION_VIEWPORT_BASELINE,
  normalizeSessionViewport,
  validateResizeViewport,
  type SessionViewportBounds,
} from './sessionViewportPolicy'

/** Alias kept for MotorEngine / older imports. */
export { SESSION_VIEWPORT_BASELINE as DEFAULT_VIEWPORT_POLICY } from './sessionViewportPolicy'

/**
 * True when the session is phone-like: suppress remote hover mouse and prefer
 * touch as the primary pointer. Hybrid Windows/Linux laptops (touchscreen +
 * mouse, maxTouchPoints>0) must stay false — capability ≠ primary mode.
 *
 * Sidecar mirrors this for CDP touch emulation (`touchEmulationParams` enables
 * only when mobile). Real finger contacts on a hybrid PC still travel as touch
 * events; mouse hover stays live.
 */
export function isTouchPrimaryProfile(profile: Pick<DeviceProfilePayload, 'mobile'>): boolean {
  return !!profile.mobile
}

/**
 * Build a DeviceProfile from the local browser environment (capped DPR 1–2).
 *
 * `touch` / `maxTouchPoints` report **capability** (finger can contact).
 * `mobile` / `deviceCategory` decide **primary mode** (phone vs PC). A Galaxy
 * Book-class hybrid is `touch: true`, `mobile: false`, `deviceCategory: 'pc'`.
 */
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
