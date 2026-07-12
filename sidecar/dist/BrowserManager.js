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
exports.profileDirForSession = profileDirForSession;
exports.launchBrowser = launchBrowser;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const patchright_1 = require("patchright");
const BrowserState_1 = require("./BrowserState");
const CHROME_EXECUTABLE = process.env['CHROME_EXECUTABLE'] ?? '/usr/bin/google-chrome';
const EXTENSION_PATH = path.resolve(__dirname, '../extensions/webgl-spoof');
function profileDirForSession(sessionId) {
    return path.join(os.tmpdir(), 'speculum-profiles', sessionId);
}
async function launchBrowser(sessionId, displayEnv, width, height, browserState) {
    const userDataDir = profileDirForSession(sessionId);
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
        viewport: null,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        colorScheme: 'dark',
    });
    let page = context.pages()[0];
    if (!page)
        page = await context.newPage();
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
    if (browserState) {
        await (0, BrowserState_1.importBrowserState)(cdp, page, browserState);
        console.log(`[${sessionId}] Restored browser state (cookies=${browserState.cookies.length})`);
    }
    return { context, page, cdp, userDataDir };
}
