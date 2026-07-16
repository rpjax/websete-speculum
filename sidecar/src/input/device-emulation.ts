import { CDPSession } from 'patchright';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../protocol/device-profile';

export async function applyDeviceEmulation(
    cdp: CDPSession,
    width: number,
    height: number,
    device: DeviceProfile = DEFAULT_DEVICE_PROFILE,
): Promise<void> {
    try {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: device.deviceScaleFactor,
            mobile: device.mobile,
            screenOrientation: device.screenOrientation
                ? {
                    type: device.screenOrientation.includes('landscape')
                        ? 'landscapePrimary'
                        : 'portraitPrimary',
                    angle: device.screenOrientation.includes('landscape') ? 90 : 0,
                }
                : undefined,
        });
    } catch { /* CDP session may have been recycled — best-effort */ }

    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', {
            enabled: device.touch || device.mobile,
            maxTouchPoints: Math.max(1, device.maxTouchPoints || (device.touch ? 5 : 1)),
        });
    } catch { /* best-effort */ }

    try {
        const version = await cdp.send('Browser.getVersion') as { product?: string; userAgent?: string };
        if (device.userAgentProfile === 'mobile') {
            const chromeVer = (version.product ?? 'Chrome/120.0.0.0').replace(/^Chrome\//, '');
            const major = chromeVer.split('.')[0] ?? '120';
            const ua =
                `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) `
                + `Chrome/${chromeVer} Mobile Safari/537.36`;
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
        } else {
            // Restore the browser default so a later desktop resize does not keep Android UA.
            const ua = version.userAgent ?? '';
            if (ua) {
                await cdp.send('Emulation.setUserAgentOverride', { userAgent: ua });
            }
        }
    } catch { /* best-effort */ }
}
