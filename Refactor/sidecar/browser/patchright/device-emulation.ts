import type { CDPSession } from 'patchright';
import type { BrowserDeviceProfile } from '../BrowserSession';

/** Desktop fallback when the client omits a device profile (dpr=1, no touch). */
export const DEFAULT_DESKTOP_DEVICE: BrowserDeviceProfile = {
  mobile: false,
  touch: false,
  deviceScaleFactor: 1,
  maxTouchPoints: 0,
};

/**
 * Drop hover-mouse input only for phone-like profiles.
 * Must match web `isTouchPrimaryProfile` — never use `touch` alone (hybrid
 * desktops report maxTouchPoints>0 and would silently lose mouse clicks).
 */
export function isInputTouchPrimary(
  device?: Pick<BrowserDeviceProfile, 'mobile'> | null,
): boolean {
  return !!device?.mobile;
}

/**
 * Chrome CDP rejects `maxTouchPoints: 0` even when touch is disabled.
 * Omit the field when disabled; require 1–16 when enabled.
 */
export function touchEmulationParams(
  device: Pick<BrowserDeviceProfile, 'touch' | 'mobile' | 'maxTouchPoints'>,
): { enabled: boolean; maxTouchPoints?: number } {
  const enabled = !!(device.touch || device.mobile);
  if (!enabled) {
    return { enabled: false };
  }

  const points = device.maxTouchPoints;
  if (points === undefined || points < 1 || points > 16) {
    throw new Error('device.maxTouchPoints must be between 1 and 16 when touch is enabled');
  }

  return { enabled: true, maxTouchPoints: points };
}

/** Normalize optional wire device into a complete profile for CDP metrics. */
export function resolveDeviceProfile(
  device?: BrowserDeviceProfile | null,
): BrowserDeviceProfile {
  if (!device) {
    return { ...DEFAULT_DESKTOP_DEVICE };
  }
  const dpr = device.deviceScaleFactor;
  const points = device.maxTouchPoints;
  return {
    mobile: !!device.mobile,
    touch: !!device.touch,
    deviceScaleFactor: dpr !== undefined && dpr > 0 ? dpr : 1,
    maxTouchPoints: points !== undefined && points >= 0 ? points : 0,
    userAgentProfile: device.userAgentProfile,
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
    && left.screenOrientation === right.screenOrientation
  );
}

export async function applyDeviceEmulation(
  cdp: CDPSession,
  width: number,
  height: number,
  device: BrowserDeviceProfile,
): Promise<void> {
  if (device.deviceScaleFactor === undefined || device.deviceScaleFactor <= 0) {
    throw new Error('device.deviceScaleFactor must be a positive number');
  }

  if (device.maxTouchPoints === undefined || device.maxTouchPoints < 0) {
    throw new Error('device.maxTouchPoints must be provided and non-negative');
  }

  // UA / touch / focus first — then metrics last. Mobile UA applied after metrics
  // leaves the legacy 980px layout viewport (cssLayoutViewport stays 980×…),
  // which is exactly the LaunchBrowserFailed we saw on iPhone Safari.
  const version = (await cdp.send('Browser.getVersion')) as {
    product?: string;
    userAgent?: string;
  };

  if (device.userAgentProfile === 'mobile' || device.mobile) {
    if (!version.product) {
      throw new Error('Browser.getVersion did not return product');
    }
    const chromeVer = version.product.replace(/^Chrome\//, '');
    const major = chromeVer.split('.')[0];
    if (!major) {
      throw new Error('Unable to parse Chrome version from product string');
    }
    const ua =
      `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ` +
      `Chrome/${chromeVer} Mobile Safari/537.36`;
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: ua,
      userAgentMetadata: buildChromeUserAgentMetadata({
        chromeVer,
        major,
        mobile: true,
        platform: 'Android',
        platformVersion: '13.0.0',
        architecture: '',
        model: 'Pixel 7',
        bitness: '',
      }),
    });
  } else {
    // Always clear mobile UA on desktop apply — soft resize must not leave prior override.
    if (!version.userAgent) {
      throw new Error('Browser.getVersion did not return userAgent');
    }
    if (!version.product) {
      throw new Error('Browser.getVersion did not return product');
    }
    const chromeVer = version.product.replace(/^Chrome\//, '');
    const major = chromeVer.split('.')[0];
    if (!major) {
      throw new Error('Unable to parse Chrome version from product string');
    }
    const desktopMeta = desktopPlatformFromUa(version.userAgent);
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: version.userAgent,
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
 * Soft logical viewport: apply only device metrics so layout/paint track the
 * client size without mutating the native Chrome window during session resizes.
 */
export async function applyLogicalViewport(
  cdp: CDPSession,
  width: number,
  height: number,
  device?: BrowserDeviceProfile | null,
): Promise<BrowserDeviceProfile> {
  const profile = resolveDeviceProfile(device);
  await applyDeviceEmulation(cdp, width, height, profile);
  return profile;
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
  options?: { epsilon?: number; phase?: string },
): Promise<{ width: number; height: number; device: BrowserDeviceProfile }> {
  const profile = await applyLogicalViewport(cdp, width, height, device);
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
