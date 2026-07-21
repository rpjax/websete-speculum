"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DEVICE = void 0;
exports.normalizeDevice = normalizeDevice;
exports.applyDeviceEmulation = applyDeviceEmulation;
exports.readChromeViewport = readChromeViewport;
exports.DEFAULT_DEVICE = {
    mobile: false,
    touch: false,
    deviceScaleFactor: 1,
    maxTouchPoints: 1,
};
function normalizeDevice(device) {
    return {
        mobile: device?.mobile ?? false,
        touch: device?.touch ?? false,
        deviceScaleFactor: device?.deviceScaleFactor ?? 1,
        maxTouchPoints: device?.maxTouchPoints ?? (device?.touch || device?.mobile ? 5 : 1),
        userAgentProfile: device?.userAgentProfile,
        screenOrientation: device?.screenOrientation,
    };
}
async function applyDeviceEmulation(cdp, width, height, device = exports.DEFAULT_DEVICE) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: device.deviceScaleFactor ?? 1,
        mobile: !!device.mobile,
        screenOrientation: device.screenOrientation
            ? {
                type: device.screenOrientation.includes('landscape')
                    ? 'landscapePrimary'
                    : 'portraitPrimary',
                angle: device.screenOrientation.includes('landscape') ? 90 : 0,
            }
            : undefined,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', {
        enabled: !!(device.touch || device.mobile),
        maxTouchPoints: Math.max(1, device.maxTouchPoints ?? (device.touch ? 5 : 1)),
    });
    if (!device.userAgentProfile && !device.mobile)
        return;
    const version = (await cdp.send('Browser.getVersion'));
    if (device.userAgentProfile === 'mobile' || device.mobile) {
        const chromeVer = (version.product ?? 'Chrome/120.0.0.0').replace(/^Chrome\//, '');
        const major = chromeVer.split('.')[0] ?? '120';
        const ua = `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ` +
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
    }
    else if (version.userAgent) {
        await cdp.send('Emulation.setUserAgentOverride', { userAgent: version.userAgent });
    }
}
async function readChromeViewport(page) {
    const dims = (await page.evaluate(`(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
    }))()`));
    return { width: Math.round(dims.width), height: Math.round(dims.height) };
}
//# sourceMappingURL=device-emulation.js.map