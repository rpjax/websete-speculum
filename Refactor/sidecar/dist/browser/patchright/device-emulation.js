"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DESKTOP_DEVICE = exports.MOBILE_VIEWPORT_META_CONTENT = exports.kitHardwareSpoofSource = exports.DEVICE_KITS = exports.resolveDeviceKit = exports.resolveDeviceCategory = void 0;
exports.isInputTouchPrimary = isInputTouchPrimary;
exports.touchEmulationParams = touchEmulationParams;
exports.resolveDeviceProfile = resolveDeviceProfile;
exports.deviceProfilesEqual = deviceProfilesEqual;
exports.applyDeviceEmulation = applyDeviceEmulation;
exports.applyKitHardwareSpoof = applyKitHardwareSpoof;
exports.buildChromeUserAgentMetadata = buildChromeUserAgentMetadata;
exports.desktopPlatformFromUa = desktopPlatformFromUa;
exports.applyNativeWindowBounds = applyNativeWindowBounds;
exports.applyLogicalViewport = applyLogicalViewport;
exports.ensureViewportMetaDocument = ensureViewportMetaDocument;
exports.installMobileViewportMetaInit = installMobileViewportMetaInit;
exports.ensurePageHasViewportMeta = ensurePageHasViewportMeta;
exports.reassertLogicalViewportAfterNavigation = reassertLogicalViewportAfterNavigation;
exports.viewportMetricsClose = viewportMetricsClose;
exports.readChromeViewport = readChromeViewport;
exports.proveLogicalViewport = proveLogicalViewport;
const device_kits_1 = require("./device-kits");
var device_kits_2 = require("./device-kits");
Object.defineProperty(exports, "resolveDeviceCategory", { enumerable: true, get: function () { return device_kits_2.resolveDeviceCategory; } });
Object.defineProperty(exports, "resolveDeviceKit", { enumerable: true, get: function () { return device_kits_2.resolveDeviceKit; } });
Object.defineProperty(exports, "DEVICE_KITS", { enumerable: true, get: function () { return device_kits_2.DEVICE_KITS; } });
Object.defineProperty(exports, "kitHardwareSpoofSource", { enumerable: true, get: function () { return device_kits_2.kitHardwareSpoofSource; } });
/** Viewport meta content used for mobile CSS layout (avoids legacy ~980px width). */
exports.MOBILE_VIEWPORT_META_CONTENT = 'width=device-width, initial-scale=1';
/** Desktop fallback when the client omits a device profile (dpr=1, no touch). */
exports.DEFAULT_DESKTOP_DEVICE = {
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
/**
 * Normalize optional wire device: kit floors for mobile/touch/mtp + category.
 * DPR stays client-driven (caller already clamped via API policy).
 */
function resolveDeviceProfile(device) {
    if (!device) {
        return { ...exports.DEFAULT_DESKTOP_DEVICE };
    }
    const kit = (0, device_kits_1.resolveDeviceKit)(device);
    const dpr = device.deviceScaleFactor;
    let points = device.maxTouchPoints;
    if (points === undefined || points < 0) {
        points = 0;
    }
    if (kit.minMaxTouchPoints > 0) {
        points = Math.max(points, kit.minMaxTouchPoints);
    }
    const defaultProfile = kit.category === 'phone' ? 'mobile' : kit.category === 'tablet' ? 'tablet' : 'desktop';
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
function deviceProfilesEqual(a, b) {
    const left = resolveDeviceProfile(a);
    const right = resolveDeviceProfile(b);
    return (left.mobile === right.mobile
        && left.touch === right.touch
        && left.deviceScaleFactor === right.deviceScaleFactor
        && left.maxTouchPoints === right.maxTouchPoints
        && left.userAgentProfile === right.userAgentProfile
        && left.deviceCategory === right.deviceCategory
        && left.screenOrientation === right.screenOrientation);
}
async function applyDeviceEmulation(cdp, width, height, device) {
    if (device.deviceScaleFactor === undefined || device.deviceScaleFactor <= 0) {
        throw new Error('device.deviceScaleFactor must be a positive number');
    }
    if (device.maxTouchPoints === undefined || device.maxTouchPoints < 0) {
        throw new Error('device.maxTouchPoints must be provided and non-negative');
    }
    const kit = (0, device_kits_1.resolveDeviceKit)(device);
    // UA / touch / focus first — then metrics last. Mobile UA applied after metrics
    // leaves the legacy 980px layout viewport (cssLayoutViewport stays 980×…),
    // which is exactly the LaunchBrowserFailed we saw on iPhone Safari.
    const version = (await cdp.send('Browser.getVersion'));
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
    }
    else {
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
    }
    await applyKitHardwareSpoof(cdp, kit);
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
/** Spoof hardwareConcurrency / deviceMemory to kit defaults (never host 22). */
async function applyKitHardwareSpoof(cdp, kit) {
    const source = (0, device_kits_1.kitHardwareSpoofSource)(kit);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
    await cdp.send('Runtime.evaluate', {
        expression: source,
        returnByValue: true,
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
 * Size the native Chrome window to the logical viewport (no fullscreen).
 * Soft resize reuses this so layout does not depend on metrics alone.
 * Verifies bounds stuck (bare Xorg — no maximizing WM).
 */
async function applyNativeWindowBounds(cdp, width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('applyNativeWindowBounds requires positive width and height');
    }
    const targetW = Math.round(width);
    const targetH = Math.round(height);
    const { windowId } = (await cdp.send('Browser.getWindowForTarget', {}));
    const bounds = {
        windowState: 'normal',
        left: 0,
        top: 0,
        width: targetW,
        height: targetH,
    };
    await cdp.send('Browser.setWindowBounds', { windowId, bounds });
    const after = (await cdp.send('Browser.getWindowBounds', { windowId }));
    const got = after.bounds;
    const w = got?.width ?? 0;
    const h = got?.height ?? 0;
    // Outer window may include browser chrome; reject only fullscreen / capacity-sized.
    const stuckWrong = !got
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
async function applyLogicalViewport(cdp, width, height, device) {
    const profile = resolveDeviceProfile(device);
    await applyNativeWindowBounds(cdp, width, height);
    await applyDeviceEmulation(cdp, width, height, profile);
    return profile;
}
/**
 * about:blank ignores mobile device-metrics for CSS layout (stays ~980px) until a
 * real document with a viewport meta exists. Seed one before proving launch geometry.
 * No-op when the page already has a non-about URL (resize / post-navigate).
 */
async function ensureViewportMetaDocument(cdp) {
    await cdp.send('Page.enable');
    const evalResult = (await cdp.send('Runtime.evaluate', {
        expression: 'location.href',
        returnByValue: true,
    }));
    const href = evalResult.result?.value ?? '';
    if (href !== 'about:blank' && !href.startsWith('about:blank')) {
        return false;
    }
    const tree = (await cdp.send('Page.getFrameTree'));
    const frameId = tree.frameTree?.frame?.id;
    if (!frameId) {
        throw Object.assign(new Error('Page.getFrameTree did not return main frame id'), {
            code: 'FAILED_PRECONDITION',
            errorCode: 'viewport_unproven',
        });
    }
    await cdp.send('Page.setDocumentContent', {
        frameId,
        html: '<!doctype html><html><head>'
            + `<meta name="viewport" content="${exports.MOBILE_VIEWPORT_META_CONTENT}">`
            + '</head><body></body></html>',
    });
    return true;
}
/**
 * Install once per mobile session: every document gets a viewport meta before layout
 * when the site omitted one (otherwise CSS stays at the legacy ~980px width).
 */
async function installMobileViewportMetaInit(page) {
    const content = JSON.stringify(exports.MOBILE_VIEWPORT_META_CONTENT);
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
async function ensurePageHasViewportMeta(cdp) {
    const result = (await cdp.send('Runtime.evaluate', {
        expression: `(() => {
      if (document.querySelector('meta[name="viewport"]')) return false;
      const m = document.createElement('meta');
      m.setAttribute('name', 'viewport');
      m.setAttribute('content', ${JSON.stringify(exports.MOBILE_VIEWPORT_META_CONTENT)});
      (document.head || document.documentElement).appendChild(m);
      return true;
    })()`,
        returnByValue: true,
    }));
    return result.result?.value === true;
}
/** After navigate/reload: ensure viewport meta (mobile) + re-apply device metrics. */
async function reassertLogicalViewportAfterNavigation(cdp, width, height, device) {
    const profile = resolveDeviceProfile(device);
    if (profile.mobile) {
        await ensurePageHasViewportMeta(cdp);
    }
    await applyDeviceEmulation(cdp, width, height, profile);
}
/** Tolerate small Chrome settle jitter when proving logical CSS size. */
function viewportMetricsClose(aW, aH, bW, bH, epsilon = 2) {
    return Math.abs(aW - bW) <= epsilon && Math.abs(aH - bH) <= epsilon;
}
/**
 * Read Chrome's CSS layout viewport after device-metrics override.
 *
 * Prefer CDP `Page.getLayoutMetrics.cssLayoutViewport` over `window.innerWidth`:
 * on mobile emulation + about:blank, `innerWidth` often reports the legacy 980px
 * layout width and does not reflect `Emulation.setDeviceMetricsOverride`.
 */
async function readChromeViewport(cdp) {
    const metrics = (await cdp.send('Page.getLayoutMetrics'));
    const css = metrics.cssLayoutViewport;
    const width = css?.clientWidth;
    const height = css?.clientHeight;
    if (width === undefined
        || height === undefined
        || !Number.isFinite(width)
        || !Number.isFinite(height)
        || width <= 0
        || height <= 0) {
        throw Object.assign(new Error('Page.getLayoutMetrics did not return cssLayoutViewport client size'), { code: 'FAILED_PRECONDITION', errorCode: 'viewport_unproven' });
    }
    return { width: Math.round(width), height: Math.round(height) };
}
/**
 * Apply logical device metrics and prove the CSS layout viewport matches.
 * Call immediately before treating a size as confirmed (launch / resize / compensate).
 */
async function proveLogicalViewport(cdp, width, height, device, options) {
    const profile = await applyLogicalViewport(cdp, width, height, device);
    // Mobile metrics on raw about:blank leave cssLayoutViewport at the legacy ~980px
    // width; seed a viewport-meta document then re-apply metrics before reading.
    // Live pages without viewport meta hit the same 980 trap — inject meta when mobile.
    if (await ensureViewportMetaDocument(cdp)) {
        await applyDeviceEmulation(cdp, width, height, profile);
    }
    else if (profile.mobile) {
        await ensurePageHasViewportMeta(cdp);
        await applyDeviceEmulation(cdp, width, height, profile);
    }
    const chrome = await readChromeViewport(cdp);
    const epsilon = options?.epsilon ?? 2;
    if (!viewportMetricsClose(chrome.width, chrome.height, width, height, epsilon)) {
        throw Object.assign(new Error(`chrome css layout viewport ${chrome.width}×${chrome.height} != logical ${width}×${height}`), {
            code: 'FAILED_PRECONDITION',
            errorCode: 'viewport_unproven',
            phase: options?.phase ?? 'prove',
        });
    }
    return { width, height, device: profile };
}
//# sourceMappingURL=device-emulation.js.map