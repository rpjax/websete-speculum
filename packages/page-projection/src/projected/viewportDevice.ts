/**
 * Device profile for viewport lockstep (DPR / mobile / touch) — Q14 / PP-SURF-5.
 * Shape matches Sessions wire + sidecar BrowserDeviceProfile.
 */

export type ViewportDeviceProfile = {
  mobile?: boolean;
  touch?: boolean;
  deviceScaleFactor?: number;
  maxTouchPoints?: number;
  userAgentProfile?: string;
  deviceCategory?: 'phone' | 'tablet' | 'pc' | string;
  screenOrientation?: string;
};

export function deviceProfilesEqual(
  a: ViewportDeviceProfile,
  b: ViewportDeviceProfile,
): boolean {
  return (
    a.mobile === b.mobile
    && a.touch === b.touch
    && a.deviceScaleFactor === b.deviceScaleFactor
    && a.maxTouchPoints === b.maxTouchPoints
    && a.userAgentProfile === b.userAgentProfile
    && a.deviceCategory === b.deviceCategory
    && a.screenOrientation === b.screenOrientation
  );
}

/**
 * Build a device profile from the local browser (capped DPR 1–2).
 * Same rules as web `detectDeviceProfile` — phone-like mobile, hybrid PC keeps mouse.
 */
export function detectViewportDeviceProfile(): ViewportDeviceProfile {
  const coarse =
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  const hoverNone =
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: none)').matches;
  const maxTouch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
  const touchCapable = coarse || maxTouch > 0;

  let uaMobile = false;
  let uaTablet = false;
  try {
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    if (typeof uaData?.mobile === 'boolean') uaMobile = uaData.mobile;
    else uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    uaTablet =
      /iPad|Tablet|Android(?!.*Mobile)/i.test(ua)
      || (
        uaMobile === false
        && touchCapable
        && Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0) >= 600
        && Math.max(window.screen?.width ?? 0, window.screen?.height ?? 0) >= 900
      );
  } catch {
    /* ignore */
  }

  const phone = (uaMobile && !uaTablet) || (coarse && hoverNone && !uaTablet);
  const tablet = uaTablet || (!phone && coarse && hoverNone && maxTouch > 0);
  const mobile = phone || tablet;
  const touch = touchCapable || mobile;
  let dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  if (!Number.isFinite(dpr) || dpr < 1) dpr = 1;
  if (dpr > 2) dpr = 2;

  let orientation: string | undefined;
  try {
    orientation = window.screen?.orientation?.type;
  } catch {
    /* ignore */
  }

  const deviceCategory: ViewportDeviceProfile['deviceCategory'] = phone
    ? 'phone'
    : tablet
      ? 'tablet'
      : 'pc';

  return {
    mobile,
    touch,
    deviceScaleFactor: dpr,
    maxTouchPoints: maxTouch,
    userAgentProfile: phone ? 'mobile' : tablet ? 'tablet' : 'desktop',
    deviceCategory,
    screenOrientation: orientation,
  };
}
