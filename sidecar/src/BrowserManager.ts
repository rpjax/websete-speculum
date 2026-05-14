import { chromium, Browser, BrowserContext, Page } from 'patchright';
import * as path from 'path';

/**
 * Launches a non-headless Chrome instance bound to a specific Xvfb display
 * via Patchright (drop-in Playwright replacement that patches Chrome's CDP
 * Runtime domain to remove all automation markers).
 *
 * The WebGL spoof extension is loaded on every launch to replace Mesa/llvmpipe
 * vendor strings with plausible Intel GPU strings.
 */

const CHROME_EXECUTABLE =
    process.env['CHROME_EXECUTABLE'] ?? '/opt/google/chrome/google-chrome';

// __dirname resolves to <sidecar_root>/dist at runtime.
// One level up reaches <sidecar_root>/extensions/webgl-spoof.
const EXTENSION_PATH = path.resolve(
    __dirname,
    '../extensions/webgl-spoof',
);

export interface BrowserHandle {
    browser: Browser;
    context: BrowserContext;
    page:    Page;
}

export async function launchBrowser(
    displayEnv: string,   // e.g. ":100"
    width:      number,
    height:     number,
): Promise<BrowserHandle> {
    const browser = await chromium.launch({
        headless:       false,
        executablePath: CHROME_EXECUTABLE,

        // Bind this browser instance to the session's virtual X11 display.
        env: {
            ...process.env as Record<string, string>,
            DISPLAY: displayEnv,
        },

        args: [
            // Security: required inside Docker (no setuid sandbox helper).
            '--no-sandbox',
            '--disable-setuid-sandbox',

            // Anti-detection: removes the `AutomationControlled` feature that
            // sets navigator.webdriver = true and adds the CDP marker to
            // window.chrome. Combined with Patchright's Runtime domain patches
            // this eliminates all known JS automation fingerprints.
            '--disable-blink-features=AutomationControlled',

            // App mode: hides Chrome's browser chrome (address bar, tabs, toolbar).
            // Navigation is driven entirely via CDP page.goto() — no UI needed.
            '--app=about:blank',

            // Geometry: open maximised to fill the entire Xvfb framebuffer.
            `--window-size=${width},${height}`,
            '--window-position=0,0',
            '--start-maximized',

            // GPU / rendering: Mesa is available but we want software rendering
            // for compatibility. The WebGL extension will spoof the vendor string.
            '--use-gl=swiftshader',

            // Load the WebGL spoof extension before any page script runs.
            `--load-extension=${EXTENSION_PATH}`,
            `--disable-extensions-except=${EXTENSION_PATH}`,

            // Performance: reduce memory overhead per session.
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',

            // Stability: disable crash reporter overhead.
            '--disable-breakpad',
        ],
    });

    // One context per browser — isolated cookies, localStorage, and network state.
    const context = await browser.newContext({
        viewport:   { width, height },
        locale:     'en-US',
        timezoneId: 'America/New_York',
        colorScheme: 'dark',
    });

    const page = await context.newPage();

    return { browser, context, page };
}
