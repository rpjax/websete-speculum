import type { BrowserContext, CDPSession, Page } from 'patchright';
import type { BrowserDeviceProfile } from '../BrowserSession';
import {
  kitNavigatorSpoofSource,
  kitStealthInitSource,
  resolveDeviceCategory,
  resolveDeviceKit,
  type DeviceCategory,
} from './device-kits';
import { ensureWorkerTargetStealth } from './worker-target-stealth';

export type { DeviceCategory };
export {
  resolveDeviceCategory,
  resolveDeviceKit,
  DEVICE_KITS,
  kitStealthInitSource,
  kitNavigatorSpoofSource,
  kitHardwareSpoofSource,
} from './device-kits';
export { ensureWorkerTargetStealth, isWorkerLikeTargetType, WORKER_TARGET_TYPES } from './worker-target-stealth';

/** Viewport meta content used for mobile CSS layout (avoids legacy ~980px width). */
export const MOBILE_VIEWPORT_META_CONTENT = 'width=device-width, initial-scale=1';

/** Desktop fallback when the client omits a device profile (dpr=1, no touch). */
export const DEFAULT_DESKTOP_DEVICE: BrowserDeviceProfile = {
  mobile: false,
  touch: false,
  deviceScaleFactor: 1,
  maxTouchPoints: 0,
  deviceCategory: 'pc',
  userAgentProfile: 'desktop',
};

/**
 * Drop hover-mouse input only for phone-like profiles.
 * Must match web `isTouchPrimaryProfile` — never use `touch` alone (hybrid
 * desktops report maxTouchPoints>0 and would silently lose mouse clicks/hover).
 */
export function isInputTouchPrimary(
  device?: Pick<BrowserDeviceProfile, 'mobile'> | null,
): boolean {
  return !!device?.mobile;
}

/**
 * CDP `Emulation.setTouchEmulationEnabled` parameters.
 *
 * Capability (`device.touch` / maxTouchPoints) ≠ touch-primary emulation:
 * - Phone/tablet (`mobile`): enable emulation so Chrome behaves as a touch device.
 * - Hybrid PC (touchscreen laptop, `touch: true` but `mobile: false`): keep
 *   emulation **off** so `:hover` / mouseenter work; real finger contacts still
 *   arrive via `Input.dispatchTouchEvent` when the client sends touch pointers.
 *
 * Chrome rejects `maxTouchPoints: 0` when enabled — omit the field when off;
 * require 1–16 when on.
 */
export function touchEmulationParams(
  device: Pick<BrowserDeviceProfile, 'touch' | 'mobile' | 'maxTouchPoints'>,
): { enabled: boolean; maxTouchPoints?: number } {
  // Align with isInputTouchPrimary — only phone/tablet sessions force touch mode.
  if (!device.mobile) {
    return { enabled: false };
  }

  const points = device.maxTouchPoints;
  if (points === undefined || points < 1 || points > 16) {
    throw new Error('device.maxTouchPoints must be between 1 and 16 when touch is enabled');
  }

  return { enabled: true, maxTouchPoints: points };
}

/**
 * Normalize optional wire device: kit floors for mobile/touch/mtp + category.
 * DPR stays client-driven (caller already clamped via API policy).
 */
export function resolveDeviceProfile(
  device?: BrowserDeviceProfile | null,
): BrowserDeviceProfile {
  if (!device) {
    return { ...DEFAULT_DESKTOP_DEVICE };
  }
  const kit = resolveDeviceKit(device);
  const dpr = device.deviceScaleFactor;
  let points = device.maxTouchPoints;
  if (points === undefined || points < 0) {
    points = 0;
  }
  if (kit.minMaxTouchPoints > 0) {
    points = Math.max(points, kit.minMaxTouchPoints);
  }

  const defaultProfile =
    kit.category === 'phone' ? 'mobile' : kit.category === 'tablet' ? 'tablet' : 'desktop';

  return {
    mobile: kit.mobile,
    touch: kit.category === 'pc' ? !!device.touch : (kit.touch || !!device.touch),
    deviceScaleFactor: dpr !== undefined && dpr > 0 ? dpr : 1,
    maxTouchPoints: kit.minMaxTouchPoints > 0
      ? Math.max(points, kit.minMaxTouchPoints)
      : points,
    userAgentProfile: device.userAgentProfile ?? defaultProfile,
    deviceCategory: kit.category,
    screenOrientation: device.screenOrientation,
  };
}

/** Wire-relevant device fields equal (soft-resize no-op check). */
export function deviceProfilesEqual(
  a: BrowserDeviceProfile | null | undefined,
  b: BrowserDeviceProfile | null | undefined,
): boolean {
  const left = resolveDeviceProfile(a);
  const right = resolveDeviceProfile(b);
  return (
    left.mobile === right.mobile
    && left.touch === right.touch
    && left.deviceScaleFactor === right.deviceScaleFactor
    && left.maxTouchPoints === right.maxTouchPoints
    && left.userAgentProfile === right.userAgentProfile
    && left.deviceCategory === right.deviceCategory
    && left.screenOrientation === right.screenOrientation
  );
}

export async function applyDeviceEmulation(
  cdp: CDPSession,
  width: number,
  height: number,
  device: BrowserDeviceProfile,
  context?: BrowserContext | null,
): Promise<void> {
  if (device.deviceScaleFactor === undefined || device.deviceScaleFactor <= 0) {
    throw new Error('device.deviceScaleFactor must be a positive number');
  }

  if (device.maxTouchPoints === undefined || device.maxTouchPoints < 0) {
    throw new Error('device.maxTouchPoints must be provided and non-negative');
  }

  const kit = resolveDeviceKit(device);

  // UA / touch / focus first — then metrics last. Mobile UA applied after metrics
  // leaves the legacy 980px layout viewport (cssLayoutViewport stays 980×…),
  // which is exactly the LaunchBrowserFailed we saw on iPhone Safari.
  const version = (await cdp.send('Browser.getVersion')) as {
    product?: string;
    userAgent?: string;
  };

  if (!version.product) {
    throw new Error('Browser.getVersion did not return product');
  }
  const chromeVer = version.product.replace(/^Chrome\//, '');
  const major = chromeVer.split('.')[0];
  if (!major) {
    throw new Error('Unable to parse Chrome version from product string');
  }

  if (kit.category === 'phone' || kit.category === 'tablet') {
    const ua = kit.buildUserAgent(chromeVer);
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: ua,
      platform: kit.navigatorPlatform,
      userAgentMetadata: buildChromeUserAgentMetadata({
        chromeVer,
        major,
        mobile: true,
        platform: kit.uaChPlatform,
        platformVersion: kit.uaChPlatformVersion,
        architecture: kit.uaChArchitecture,
        model: kit.uaChModel,
        bitness: kit.uaChBitness,
      }),
    });
    await applyKitStealthInit(cdp, kit, ua, context);
  } else {
    // Always clear mobile UA on desktop apply — soft resize must not leave prior override.
    if (!version.userAgent) {
      throw new Error('Browser.getVersion did not return userAgent');
    }
    const desktopMeta = desktopPlatformFromUa(version.userAgent);
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: version.userAgent,
      platform: kit.navigatorPlatform,
      userAgentMetadata: buildChromeUserAgentMetadata({
        chromeVer,
        major,
        mobile: false,
        platform: desktopMeta.platform,
        platformVersion: desktopMeta.platformVersion,
        architecture: desktopMeta.architecture,
        model: '',
        bitness: desktopMeta.bitness,
      }),
    });
    await applyKitStealthInit(cdp, kit, version.userAgent, context);
  }

  await cdp.send('Emulation.setTouchEmulationEnabled', touchEmulationParams(device));

  // Xvfb/headless pages are often unfocused; without this, CDP mouse hits the right
  // elementFromPoint target but never activates focus or click handlers (ML cookie
  // banner / search input stayed inert with activeElement === body).
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: device.deviceScaleFactor,
    mobile: !!device.mobile,
    // Match logical viewport — Xvfb is overallocated; screen.* must not report capacity max.
    screenWidth: width,
    screenHeight: height,
    screenOrientation: device.screenOrientation
      ? {
          type: device.screenOrientation.includes('landscape')
            ? 'landscapePrimary'
            : 'portraitPrimary',
          angle: device.screenOrientation.includes('landscape') ? 90 : 0,
        }
      : undefined,
  });
}

/** Kit HW + WebGL UNMASKED + classic Worker wrap (never host cores / GPU strings). */
export async function applyKitStealthInit(
  cdp: CDPSession,
  kit: ReturnType<typeof resolveDeviceKit>,
  userAgent: string,
  context?: BrowserContext | null,
): Promise<void> {
  const source = kitStealthInitSource({ kit, userAgent });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
  await cdp.send('Runtime.evaluate', {
    expression: source,
    returnByValue: true,
  });
  // Browser-wide: every worker-like target (any site) gets kit navigator identity.
  await ensureWorkerTargetStealth({
    pageCdp: cdp,
    source: kitNavigatorSpoofSource({ kit, userAgent }),
    context: context ?? null,
  });
}

/** @deprecated Prefer applyKitStealthInit with UA. */
export async function applyKitHardwareSpoof(
  cdp: CDPSession,
  kit: ReturnType<typeof resolveDeviceKit>,
): Promise<void> {
  await applyKitStealthInit(cdp, kit, '');
}

/** Greasy Client Hints brands matching current Chrome (sec-ch-ua consistency). */
export function buildChromeUserAgentMetadata(args: {
  chromeVer: string;
  major: string;
  mobile: boolean;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  bitness: string;
}): {
  brands: Array<{ brand: string; version: string }>;
  fullVersionList: Array<{ brand: string; version: string }>;
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
  wow64: boolean;
} {
  const greasyBrand = greasyNotABrand(args.major);
  const brands = [
    { brand: greasyBrand.brand, version: greasyBrand.version },
    { brand: 'Chromium', version: args.major },
    { brand: 'Google Chrome', version: args.major },
  ];
  const fullVersionList = [
    { brand: greasyBrand.brand, version: greasyBrand.fullVersion },
    { brand: 'Chromium', version: args.chromeVer },
    { brand: 'Google Chrome', version: args.chromeVer },
  ];
  return {
    brands,
    fullVersionList,
    fullVersion: args.chromeVer,
    platform: args.platform,
    platformVersion: args.platformVersion,
    architecture: args.architecture,
    model: args.model,
    mobile: args.mobile,
    bitness: args.bitness,
    wow64: false,
  };
}

/** Derive desktop CH platform fields from Chrome's native Linux/Windows/macOS UA. */
export function desktopPlatformFromUa(userAgent: string): {
  platform: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
} {
  if (/Windows NT/i.test(userAgent)) {
    return {
      platform: 'Windows',
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
    };
  }
  if (/Mac OS X/i.test(userAgent)) {
    return {
      platform: 'macOS',
      platformVersion: '14.0.0',
      architecture: 'x86',
      bitness: '64',
    };
  }
  // Container Chrome is Linux x86_64.
  return {
    platform: 'Linux',
    platformVersion: '6.5.0',
    architecture: 'x86',
    bitness: '64',
  };
}

/**
 * Chrome rotates a "Not_A Brand" / greasy brand to poison UA-CH parsers.
 * Seed from major so the set stays stable within a Chrome version.
 */
function greasyNotABrand(major: string): { brand: string; version: string; fullVersion: string } {
  const n = Number.parseInt(major, 10);
  const seed = Number.isFinite(n) ? n % 3 : 0;
  if (seed === 0) {
    return { brand: 'Not_A Brand', version: '8', fullVersion: '10.0.0.0' };
  }
  if (seed === 1) {
    return { brand: 'Not)A;Brand', version: '24', fullVersion: '24.0.0.0' };
  }
  return { brand: 'Not A(Brand', version: '99', fullVersion: '99.0.0.0' };
}

/**
 * Size the native Chrome window to the logical viewport (no fullscreen).
 * Soft resize reuses this so layout does not depend on metrics alone.
 * Verifies bounds stuck (bare Xorg — no maximizing WM).
 */
export async function applyNativeWindowBounds(
  cdp: CDPSession,
  width: number,
  height: number,
): Promise<void> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('applyNativeWindowBounds requires positive width and height');
  }
  const targetW = Math.round(width);
  const targetH = Math.round(height);
  const { windowId } = (await cdp.send('Browser.getWindowForTarget', {})) as {
    windowId: number;
  };
  const bounds = {
    windowState: 'normal' as const,
    left: 0,
    top: 0,
    width: targetW,
    height: targetH,
  };
  await cdp.send('Browser.setWindowBounds', { windowId, bounds });
  const after = (await cdp.send('Browser.getWindowBounds', { windowId })) as {
    bounds?: { windowState?: string; width?: number; height?: number };
  };
  const got = after.bounds;
  const w = got?.width ?? 0;
  const h = got?.height ?? 0;
  // Outer window may include browser chrome; reject only fullscreen / capacity-sized.
  const stuckWrong =
    !got
    || got.windowState === 'fullscreen'
    || w >= targetW * 3
    || h >= targetH * 3;
  if (stuckWrong) {
    await cdp.send('Browser.setWindowBounds', { windowId, bounds });
  }
}

/**
 * Soft logical viewport: native window bounds + device metrics so layout/paint
 * track the client size without recreating Chrome/Xvfb.
 */
export async function applyLogicalViewport(
  cdp: CDPSession,
  width: number,
  height: number,
  device?: BrowserDeviceProfile | null,
  context?: BrowserContext | null,
): Promise<BrowserDeviceProfile> {
  const profile = resolveDeviceProfile(device);
  await applyNativeWindowBounds(cdp, width, height);
  await applyDeviceEmulation(cdp, width, height, profile, context);
  return profile;
}

/**
 * about:blank ignores mobile device-metrics for CSS layout (stays ~980px) until a
 * real document with a viewport meta exists. Seed one before proving launch geometry.
 * No-op when the page already has a non-about URL (resize / post-navigate).
 */
export async function ensureViewportMetaDocument(cdp: CDPSession): Promise<boolean> {
  await cdp.send('Page.enable');
  const evalResult = (await cdp.send('Runtime.evaluate', {
    expression: 'location.href',
    returnByValue: true,
  })) as { result?: { value?: string } };
  const href = evalResult.result?.value ?? '';
  if (href !== 'about:blank' && !href.startsWith('about:blank')) {
    return false;
  }

  const tree = (await cdp.send('Page.getFrameTree')) as {
    frameTree?: { frame?: { id?: string } };
  };
  const frameId = tree.frameTree?.frame?.id;
  if (!frameId) {
    throw Object.assign(new Error('Page.getFrameTree did not return main frame id'), {
      code: 'FAILED_PRECONDITION',
      errorCode: 'viewport_unproven',
    });
  }

  await cdp.send('Page.setDocumentContent', {
    frameId,
    html:
      '<!doctype html><html><head>'
      + `<meta name="viewport" content="${MOBILE_VIEWPORT_META_CONTENT}">`
      + '</head><body></body></html>',
  });
  return true;
}

/**
 * Install once per mobile session: every document gets a viewport meta before layout
 * when the site omitted one (otherwise CSS stays at the legacy ~980px width).
 */
export async function installMobileViewportMetaInit(page: Page): Promise<void> {
  const content = JSON.stringify(MOBILE_VIEWPORT_META_CONTENT);
  await page.addInitScript(`(() => {
    const content = ${content};
    const ensure = () => {
      if (document.querySelector('meta[name="viewport"]')) return;
      const m = document.createElement('meta');
      m.setAttribute('name', 'viewport');
      m.setAttribute('content', content);
      (document.head || document.documentElement)?.appendChild(m);
    };
    ensure();
    document.addEventListener('DOMContentLoaded', ensure);
  })()`);
}

/**
 * Pages without a viewport meta keep the legacy ~980px mobile layout even when
 * device metrics override screen.*. Inject meta when missing (mobile sessions).
 */
export async function ensurePageHasViewportMeta(cdp: CDPSession): Promise<boolean> {
  const result = (await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      if (document.querySelector('meta[name="viewport"]')) return false;
      const m = document.createElement('meta');
      m.setAttribute('name', 'viewport');
      m.setAttribute('content', ${JSON.stringify(MOBILE_VIEWPORT_META_CONTENT)});
      (document.head || document.documentElement).appendChild(m);
      return true;
    })()`,
    returnByValue: true,
  })) as { result?: { value?: boolean } };
  return result.result?.value === true;
}

/** After navigate/reload: ensure viewport meta (mobile) + re-apply device metrics. */
export async function reassertLogicalViewportAfterNavigation(
  cdp: CDPSession,
  width: number,
  height: number,
  device?: BrowserDeviceProfile | null,
  context?: BrowserContext | null,
): Promise<void> {
  const profile = resolveDeviceProfile(device);
  if (profile.mobile) {
    await ensurePageHasViewportMeta(cdp);
  }
  await applyDeviceEmulation(cdp, width, height, profile, context);
}

/** Tolerate small Chrome settle jitter when proving logical CSS size. */
export function viewportMetricsClose(
  aW: number,
  aH: number,
  bW: number,
  bH: number,
  epsilon = 2,
): boolean {
  return Math.abs(aW - bW) <= epsilon && Math.abs(aH - bH) <= epsilon;
}

type LayoutMetricsResponse = {
  cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
};

/**
 * Read Chrome's CSS layout viewport after device-metrics override.
 *
 * Prefer CDP `Page.getLayoutMetrics.cssLayoutViewport` over `window.innerWidth`:
 * on mobile emulation + about:blank, `innerWidth` often reports the legacy 980px
 * layout width and does not reflect `Emulation.setDeviceMetricsOverride`.
 */
export async function readChromeViewport(
  cdp: CDPSession,
): Promise<{ width: number; height: number }> {
  const metrics = (await cdp.send('Page.getLayoutMetrics')) as LayoutMetricsResponse;
  const css = metrics.cssLayoutViewport;
  const width = css?.clientWidth;
  const height = css?.clientHeight;
  if (
    width === undefined
    || height === undefined
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    throw Object.assign(
      new Error('Page.getLayoutMetrics did not return cssLayoutViewport client size'),
      { code: 'FAILED_PRECONDITION', errorCode: 'viewport_unproven' },
    );
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Apply logical device metrics and prove the CSS layout viewport matches.
 * Call immediately before treating a size as confirmed (launch / resize / compensate).
 */
export async function proveLogicalViewport(
  cdp: CDPSession,
  width: number,
  height: number,
  device?: BrowserDeviceProfile | null,
  options?: { epsilon?: number; phase?: string; context?: BrowserContext | null },
): Promise<{ width: number; height: number; device: BrowserDeviceProfile }> {
  const context = options?.context ?? null;
  const profile = await applyLogicalViewport(cdp, width, height, device, context);
  // Mobile metrics on raw about:blank leave cssLayoutViewport at the legacy ~980px
  // width; seed a viewport-meta document then re-apply metrics before reading.
  // Live pages without viewport meta hit the same 980 trap — inject meta when mobile.
  if (await ensureViewportMetaDocument(cdp)) {
    await applyDeviceEmulation(cdp, width, height, profile, context);
  } else if (profile.mobile) {
    await ensurePageHasViewportMeta(cdp);
    await applyDeviceEmulation(cdp, width, height, profile, context);
  }
  const chrome = await readChromeViewport(cdp);
  const epsilon = options?.epsilon ?? 2;
  if (!viewportMetricsClose(chrome.width, chrome.height, width, height, epsilon)) {
    throw Object.assign(
      new Error(
        `chrome css layout viewport ${chrome.width}×${chrome.height} != logical ${width}×${height}`,
      ),
      {
        code: 'FAILED_PRECONDITION',
        errorCode: 'viewport_unproven',
        phase: options?.phase ?? 'prove',
      },
    );
  }
  return { width, height, device: profile };
}
