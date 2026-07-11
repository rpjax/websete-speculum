import * as path from 'path';
import { chromium, BrowserContext, Page, CDPSession } from 'patchright';
import { extractProfile, profileDirForSession } from './ProfileArchive';
import * as fs from 'fs';

const CHROME_EXECUTABLE =
    process.env['CHROME_EXECUTABLE'] ?? '/usr/bin/google-chrome';

const EXTENSION_PATH = path.resolve(__dirname, '../extensions/webgl-spoof');

export interface BrowserHandle {
    context:     BrowserContext;
    page:        Page;
    cdp:         CDPSession;
    userDataDir: string;
}

export async function launchBrowser(
    sessionId:  string,
    displayEnv: string,
    width:      number,
    height:     number,
    profileBlob?: Buffer,
): Promise<BrowserHandle> {
    const userDataDir = profileDirForSession(sessionId);

    if (profileBlob && profileBlob.length > 0) {
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        await extractProfile(userDataDir, profileBlob);
        console.log(`[${sessionId}] Restored profile (${profileBlob.length} bytes) → ${userDataDir}`);
    } else {
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }

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
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: 1,
            mobile:            false,
        });
    } catch (err) {
        console.warn('[BrowserManager] setDeviceMetricsOverride failed:', (err as Error).message);
    }

    return { context, page, cdp, userDataDir };
}
