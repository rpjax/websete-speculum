"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.launchBrowser = launchBrowser;
const patchright_1 = require("patchright");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
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
const CHROME_EXECUTABLE = process.env['CHROME_EXECUTABLE'] ?? '/opt/google/chrome/google-chrome';
const EXTENSION_PATH = path.resolve(__dirname, '../extensions/webgl-spoof');
async function launchBrowser(displayEnv, // e.g. ":100"
width, height) {
    const displayId = displayEnv.replace(':', '');
    const userDataDir = `/tmp/speculum-profile-${displayId}`;
    // Fresh profile on every session — prevents Chrome from restoring a
    // previously-saved non-fullscreen window state.
    try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
    }
    catch { /* best-effort */ }
    const context = await patchright_1.chromium.launchPersistentContext(userDataDir, {
        headless: false,
        executablePath: CHROME_EXECUTABLE,
        env: {
            ...process.env,
            DISPLAY: displayEnv,
        },
        args: [
            // Security.
            '--no-sandbox',
            '--test-type', // suppresses the "unsupported flag: --no-sandbox" infobar
            // Anti-detection.
            '--disable-blink-features=AutomationControlled',
            `--window-size=${width},${height}`,
            '--window-position=0,0',
            // Suppress the "Press Esc to exit fullscreen" browser notification
            // that appears when setWindowBounds switches Chrome to fullscreen state.
            '--disable-features=ExclusiveAccessBubble',
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
        viewport: null,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        colorScheme: 'dark',
    });
    let page = context.pages()[0];
    if (!page)
        page = await context.newPage();
    // CDP setup:
    //   1. setWindowBounds { fullscreen } hides Chrome's browser chrome
    //      (address bar, tab bar, toolbar). Startup flags like --kiosk or
    //      --start-fullscreen do not reliably hide the UI when the window is
    //      created via launchPersistentContext.
    //
    //   2. setDeviceMetricsOverride is the AUTHORITATIVE viewport controller.
    //      setWindowBounds { fullscreen } asks matchbox-window-manager to fill
    //      the screen — but matchbox may use the Xvfb physical framebuffer size
    //      (4096×2160, the SHM allocation) rather than the xrandr virtual
    //      resolution (width×height). That causes Chrome to render at 4096×2160
    //      and FFmpeg to capture only a partial view. setDeviceMetricsOverride
    //      tells Chrome's renderer exactly what viewport to use, bypassing all
    //      WM / RANDR ambiguity.  FFmpeg always captures from (0,0); the
    //      rendered content always starts at (0,0) in fullscreen mode.
    //
    //   The cdp session is kept alive and returned to the caller so that resize
    //   operations can update the override without opening a new session.
    const cdp = await context.newCDPSession(page);
    try {
        const { windowId } = await cdp.send('Browser.getWindowForTarget', {});
        await cdp.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'fullscreen' },
        });
    }
    catch (err) {
        console.warn('[BrowserManager] setWindowBounds failed:', err.message);
    }
    try {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: 1,
            mobile: false,
        });
    }
    catch (err) {
        console.warn('[BrowserManager] setDeviceMetricsOverride failed:', err.message);
    }
    return { context, page, cdp };
}
