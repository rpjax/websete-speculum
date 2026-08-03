"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVICE_KITS = void 0;
exports.resolveDeviceCategory = resolveDeviceCategory;
exports.resolveDeviceKit = resolveDeviceKit;
exports.kitHardwareSpoofSource = kitHardwareSpoofSource;
const PHONE_KIT = {
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
    buildUserAgent: (chromeVer) => `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) `
        + `Chrome/${chromeVer} Mobile Safari/537.36`,
};
const TABLET_KIT = {
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
    buildUserAgent: (chromeVer) => `Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) `
        + `Chrome/${chromeVer} Safari/537.36`,
};
const PC_KIT = {
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
exports.DEVICE_KITS = {
    phone: PHONE_KIT,
    tablet: TABLET_KIT,
    pc: PC_KIT,
};
/**
 * Resolve kit category from wire profile.
 * Accepts explicit deviceCategory, userAgentProfile aliases, or mobile flag.
 */
function resolveDeviceCategory(device) {
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
function resolveDeviceKit(device) {
    return exports.DEVICE_KITS[resolveDeviceCategory(device)];
}
/** Init-script source: navigator.hardwareConcurrency / deviceMemory from kit. */
function kitHardwareSpoofSource(kit) {
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
//# sourceMappingURL=device-kits.js.map