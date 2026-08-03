import type { BrowserDeviceProfile } from '../BrowserSession';

/** Antibot form-factor kits — identity + HW defaults (never host cores). */
export type DeviceCategory = 'phone' | 'tablet' | 'pc';

export interface DeviceKit {
  category: DeviceCategory;
  /** CDP Emulation.setUserAgentOverride.platform (navigator.platform). */
  navigatorPlatform: string;
  /** UA-CH platform string. */
  uaChPlatform: string;
  uaChPlatformVersion: string;
  uaChArchitecture: string;
  uaChBitness: string;
  uaChModel: string;
  mobile: boolean;
  touch: boolean;
  minMaxTouchPoints: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  /** Build UA with live Chrome version from Browser.getVersion. */
  buildUserAgent: (chromeVer: string) => string;
}

const PHONE_KIT: DeviceKit = {
  category: 'phone',
  navigatorPlatform: 'Linux armv8l',
  uaChPlatform: 'Android',
  uaChPlatformVersion: '13.0.0',
  uaChArchitecture: '',
  uaChBitness: '',
  uaChModel: 'Pixel 7',
  mobile: true,
  touch: true,
  minMaxTouchPoints: 5,
  hardwareConcurrency: 8,
  deviceMemory: 4,
  buildUserAgent: (chromeVer) =>
    `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) `
    + `Chrome/${chromeVer} Mobile Safari/537.36`,
};

const TABLET_KIT: DeviceKit = {
  category: 'tablet',
  navigatorPlatform: 'Linux armv8l',
  uaChPlatform: 'Android',
  uaChPlatformVersion: '14.0.0',
  uaChArchitecture: '',
  uaChBitness: '',
  uaChModel: 'Pixel Tablet',
  mobile: true,
  touch: true,
  minMaxTouchPoints: 5,
  hardwareConcurrency: 8,
  deviceMemory: 4,
  buildUserAgent: (chromeVer) =>
    `Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) `
    + `Chrome/${chromeVer} Safari/537.36`,
};

const PC_KIT: DeviceKit = {
  category: 'pc',
  navigatorPlatform: 'Linux x86_64',
  uaChPlatform: 'Linux',
  uaChPlatformVersion: '6.5.0',
  uaChArchitecture: 'x86',
  uaChBitness: '64',
  uaChModel: '',
  mobile: false,
  touch: false,
  minMaxTouchPoints: 0,
  hardwareConcurrency: 8,
  deviceMemory: 8,
  // Desktop uses Chrome's native UA from Browser.getVersion (Linux container).
  buildUserAgent: () => '',
};

export const DEVICE_KITS: Record<DeviceCategory, DeviceKit> = {
  phone: PHONE_KIT,
  tablet: TABLET_KIT,
  pc: PC_KIT,
};

/**
 * Resolve kit category from wire profile.
 * Accepts explicit deviceCategory, userAgentProfile aliases, or mobile flag.
 */
export function resolveDeviceCategory(
  device?: Pick<BrowserDeviceProfile, 'mobile' | 'userAgentProfile' | 'deviceCategory'> | null,
): DeviceCategory {
  const raw = (device?.deviceCategory ?? device?.userAgentProfile ?? '').trim().toLowerCase();
  if (raw === 'phone' || raw === 'mobile') {
    return 'phone';
  }
  if (raw === 'tablet') {
    return 'tablet';
  }
  if (raw === 'pc' || raw === 'desktop') {
    return 'pc';
  }
  return device?.mobile ? 'phone' : 'pc';
}

export function resolveDeviceKit(
  device?: Pick<BrowserDeviceProfile, 'mobile' | 'userAgentProfile' | 'deviceCategory'> | null,
): DeviceKit {
  return DEVICE_KITS[resolveDeviceCategory(device)];
}

/** Init-script source: navigator.hardwareConcurrency / deviceMemory from kit. */
export function kitHardwareSpoofSource(kit: DeviceKit): string {
  const cores = kit.hardwareConcurrency;
  const mem = kit.deviceMemory;
  return `(() => {
  const cores = ${cores};
  const mem = ${mem};
  try {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
      get: () => cores,
      configurable: true,
    });
  } catch (_) {}
  try {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      get: () => mem,
      configurable: true,
    });
  } catch (_) {}
})();`;
}
