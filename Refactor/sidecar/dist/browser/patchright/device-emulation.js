"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DESKTOP_DEVICE = void 0;
exports.isInputTouchPrimary = isInputTouchPrimary;
exports.touchEmulationParams = touchEmulationParams;
exports.resolveDeviceProfile = resolveDeviceProfile;
exports.deviceProfilesEqual = deviceProfilesEqual;
exports.applyDeviceEmulation = applyDeviceEmulation;
exports.buildChromeUserAgentMetadata = buildChromeUserAgentMetadata;
exports.desktopPlatformFromUa = desktopPlatformFromUa;
exports.applyLogicalViewport = applyLogicalViewport;
exports.readChromeViewport = readChromeViewport;
/** Desktop fallback when the client omits a device profile (dpr=1, no touch). */
exports.DEFAULT_DESKTOP_DEVICE = {
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
function isInputTouchPrimary(device) {
    return !!device?.mobile;
}
/**
 * Chrome CDP rejects `maxTouchPoints: 0` even when touch is disabled.
 * Omit the field when disabled; require 1–16 when enabled.
 */
function touchEmulationParams(device) {
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
function resolveDeviceProfile(device) {
    if (!device) {
        return { ...exports.DEFAULT_DESKTOP_DEVICE };
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
function deviceProfilesEqual(a, b) {
    const left = resolveDeviceProfile(a);
    const right = resolveDeviceProfile(b);
    return (left.mobile === right.mobile
        && left.touch === right.touch
        && left.deviceScaleFactor === right.deviceScaleFactor
        && left.maxTouchPoints === right.maxTouchPoints
        && left.userAgentProfile === right.userAgentProfile
        && left.screenOrientation === right.screenOrientation);
}
async function applyDeviceEmulation(cdp, width, height, device) {
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
    // Xvfb/headless pages are often unfocused; without this, CDP mouse hits the right
    // elementFromPoint target but never activates focus or click handlers (ML cookie
    // banner / search input stayed inert with activeElement === body).
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const version = (await cdp.send('Browser.getVersion'));
    if (device.userAgentProfile === 'mobile' || device.mobile) {
        if (!version.product) {
            throw new Error('Browser.getVersion did not return product');
        }
        const chromeVer = version.product.replace(/^Chrome\//, '');
        const major = chromeVer.split('.')[0];
        if (!major) {
            throw new Error('Unable to parse Chrome version from product string');
        }
        const ua = `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ` +
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
        return;
    }
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
/** Greasy Client Hints brands matching current Chrome (sec-ch-ua consistency). */
function buildChromeUserAgentMetadata(args) {
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
function desktopPlatformFromUa(userAgent) {
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
function greasyNotABrand(major) {
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
async function applyLogicalViewport(cdp, width, height, device) {
    const profile = resolveDeviceProfile(device);
    await applyDeviceEmulation(cdp, width, height, profile);
    return profile;
}
async function readChromeViewport(page) {
    const dims = (await page.evaluate(`(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
    }))()`));
    return { width: Math.round(dims.width), height: Math.round(dims.height) };
}
//# sourceMappingURL=device-emulation.js.map