import type { CDPSession, Page } from 'patchright';
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

  await cdp.send('Emulation.setTouchEmulationEnabled', touchEmulationParams(device));

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
      userAgentMetadata: {
        brands: [
          { brand: 'Chromium', version: major },
          { brand: 'Google Chrome', version: major },
        ],
        fullVersion: chromeVer,
        platform: 'Android',
        platformVersion: '13.0.0',
        architecture: '',
        model: 'Pixel 7',
        mobile: true,
      },
    });
    return;
  }

  // Always clear mobile UA on desktop apply — soft resize must not leave prior override.
  if (!version.userAgent) {
    throw new Error('Browser.getVersion did not return userAgent');
  }
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: version.userAgent });
}

/**
 * Soft logical viewport: window bounds at W×H (not fullscreen-on-max display)
 * plus device metrics so layout/paint track the client size.
 */
export async function applyLogicalViewport(
  cdp: CDPSession,
  width: number,
  height: number,
  device?: BrowserDeviceProfile | null,
): Promise<BrowserDeviceProfile> {
  const profile = resolveDeviceProfile(device);
  const { windowId } = (await cdp.send('Browser.getWindowForTarget', {})) as {
    windowId: number;
  };
  await cdp.send('Browser.setWindowBounds', {
    windowId,
    bounds: {
      left: 0,
      top: 0,
      width,
      height,
      windowState: 'normal',
    },
  });
  await applyDeviceEmulation(cdp, width, height, profile);
  return profile;
}

export async function readChromeViewport(page: Page): Promise<{ width: number; height: number }> {
  const dims = (await page.evaluate(`(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
    }))()`)) as { width: number; height: number };
  return { width: Math.round(dims.width), height: Math.round(dims.height) };
}
