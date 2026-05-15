import { chromium, BrowserContext, Page } from 'patchright';
import * as path from 'path';
import * as fs   from 'fs';

/**
 * Launches a non-headless Chrome instance bound to a specific Xvfb display.
 *
 * ── Why we delete the profile dir on every launch ────────────────────────────
 * Chrome persists window bounds in the profile (Default/Preferences → "browser"
 * → "window_placement"). If a previous session left the window in non-fullscreen
 * state, Chrome restores that on next launch and ignores --start-fullscreen.
 * Deleting the dir before launch guarantees a clean slate every session.
 * Cookies/localStorage are irrelevant here — each session is intentionally
 * isolated, and the profile is scoped per-display so concurrent sessions never
 * collide.
 *
 * ── Why CDP setWindowBounds instead of --start-fullscreen / --kiosk / --app ─
 * Those flags only affect the window Chrome creates at startup. Playwright's
 * launchPersistentContext may create or adopt a different window via CDP; that
 * window ignores startup flags. Browser.setWindowBounds targets the exact window
 * our page lives in — it works reliably regardless of how the window was created.
 *
 * ── Suppressing the "press Esc to exit" notification ────────────────────────
 * The notification is part of Chrome's ExclusiveAccessBubble feature. Disabling
 * it via --disable-features=ExclusiveAccessBubble prevents it from appearing
 * when we call setWindowBounds { windowState: 'fullscreen' }.
 */

const CHROME_EXECUTABLE =
    process.env['CHROME_EXECUTABLE'] ?? '/opt/google/chrome/google-chrome';

const EXTENSION_PATH = path.resolve(__dirname, '../extensions/webgl-spoof');

export interface BrowserHandle {
    context: BrowserContext;
    page:    Page;
}

export async function launchBrowser(
    displayEnv: string,   // e.g. ":100"
    width:      number,
    height:     number,
): Promise<BrowserHandle> {
    const displayId   = displayEnv.replace(':', '');
    const userDataDir = `/tmp/speculum-profile-${displayId}`;

    // Fresh profile on every session — prevents Chrome from restoring a
    // previously-saved non-fullscreen window state.
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best-effort */ }

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless:       false,
        executablePath: CHROME_EXECUTABLE,

        env: {
            ...process.env as Record<string, string>,
            DISPLAY: displayEnv,
        },

        args: [
            // Security.
            '--no-sandbox',
            '--test-type',   // suppresses the "unsupported flag: --no-sandbox" infobar

            // Anti-detection.
            '--disable-blink-features=AutomationControlled',

            `--window-size=${width},${height}`,
            '--window-position=0,0',

            // GPU: software renderer for Docker compatibility.
            '--use-gl=swiftshader',

            // WebGL vendor spoof extension.
            `--load-extension=${EXTENSION_PATH}`,
            `--disable-extensions-except=${EXTENSION_PATH}`,

            // Performance / noise reduction.
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--disable-breakpad',
        ],

        // null = let Chrome use its natural window size instead of injecting
        // Emulation.setDeviceMetricsOverride via CDP. After setWindowBounds
        // makes the window fullscreen, Chrome renders at the Xvfb resolution
        // exactly. Forcing a viewport override on top of that creates a mismatch
        // that causes sites to add a compensatory horizontal scrollbar.
        viewport:    null,
        locale:      'en-US',
        timezoneId:  'America/New_York',
        colorScheme: 'dark',
    });

    let page = context.pages()[0];
    if (!page) page = await context.newPage();

    // CDP setWindowBounds is the only reliable way to hide Chrome's browser
    // chrome (address bar, tabs, toolbar) when the page is created via
    // launchPersistentContext. Startup flags (--kiosk, --start-fullscreen,
    // --app) apply to Chrome's own startup window, not to the window
    // Playwright connects to via CDP.
    try {
        const cdp = await context.newCDPSession(page);
        const { windowId } = await cdp.send('Browser.getWindowForTarget', {});
        await cdp.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'fullscreen' },
        });
        await cdp.detach();
    } catch (err) {
        console.warn('[BrowserManager] setWindowBounds failed:', (err as Error).message);
    }

    return { context, page };
}
