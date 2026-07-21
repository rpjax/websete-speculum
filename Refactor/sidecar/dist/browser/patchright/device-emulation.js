"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyDeviceEmulation = applyDeviceEmulation;
exports.readChromeViewport = readChromeViewport;
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
        maxTouchPoints: device.maxTouchPoints,
    });
    if (!device.userAgentProfile && !device.mobile)
        return;
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