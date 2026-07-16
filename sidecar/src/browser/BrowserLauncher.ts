import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, BrowserContext, Page, CDPSession } from 'patchright';
import { BrowserStatePayload, importBrowserState } from '../BrowserState';
import { applyDeviceEmulation } from '../input/device-emulation';
import { normalizeDeviceProfile, type DeviceProfile } from '../protocol/device-profile';

const CHROME_EXECUTABLE =
    process.env['CHROME_EXECUTABLE'] ?? '/usr/bin/google-chrome';

const EXTENSION_PATH = path.resolve(__dirname, '../../extensions/webgl-spoof');

export interface BrowserHandle {
    context:     BrowserContext;
    page:        Page;
    cdp:         CDPSession;
    userDataDir: string;
}

export function profileDirForSession(sessionId: string): string {
    return path.join(os.tmpdir(), 'speculum-profiles', sessionId);
}

export async function launchBrowser(
    sessionId:    string,
    displayEnv:   string,
    width:        number,
    height:       number,
    browserState?: BrowserStatePayload,
    device?:      DeviceProfile,
): Promise<BrowserHandle> {
    const profile = normalizeDeviceProfile(device);
    const userDataDir = profileDirForSession(sessionId);

    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best-effort */ }

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless:       false,
        executablePath: CHROME_EXECUTABLE,

        env: {
            ...process.env as Record<string, string>,
            DISPLAY: displayEnv,
        },

        args: [
            '--no-sandbox',
            '--test-type',
            '--disable-blink-features=AutomationControlled',
            `--window-size=${width},${height}`,
            '--window-position=0,0',
            '--disable-features=ExclusiveAccessBubble',
            '--use-gl=swiftshader',
            `--load-extension=${EXTENSION_PATH}`,
            `--disable-extensions-except=${EXTENSION_PATH}`,
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--disable-breakpad',
            ...(process.env['SPECULUM_IGNORE_CERT_ERRORS'] === '1'
                ? ['--ignore-certificate-errors']
                : []),
        ],

        viewport:    null,
        locale:      'en-US',
        timezoneId:  'America/New_York',
        colorScheme: 'dark',
    });

    let page = context.pages()[0];
    if (!page) page = await context.newPage();

    const cdp = await context.newCDPSession(page);
    try {
        const { windowId } = await cdp.send('Browser.getWindowForTarget', {});
        await cdp.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'fullscreen' },
        });
    } catch (err) {
        console.warn('[BrowserManager] setWindowBounds failed:', (err as Error).message);
    }

    try {
        await applyDeviceEmulation(cdp, width, height, profile);
    } catch (err) {
        console.warn('[BrowserManager] device emulation failed:', (err as Error).message);
    }

    if (browserState) {
        await importBrowserState(cdp, page, browserState);
        console.log(`[${sessionId}] Restored browser state (cookies=${browserState.cookies.length})`);
    }

    return { context, page, cdp, userDataDir };
}
