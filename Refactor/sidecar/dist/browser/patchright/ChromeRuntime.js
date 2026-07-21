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
exports.launchChrome = launchChrome;
exports.closeChrome = closeChrome;
exports.injectScriptTags = injectScriptTags;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const patchright_1 = require("patchright");
const device_emulation_1 = require("./device-emulation");
const CHROME_EXECUTABLE = process.env['CHROME_EXECUTABLE'] ?? '/usr/bin/google-chrome';
function profileDirForSession(sessionId) {
    return path.join(os.tmpdir(), 'speculum-profiles', sessionId);
}
function buildChromeArgs(width, height) {
    const args = [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        `--window-size=${width},${height}`,
        '--window-position=0,0',
        '--disable-features=ExclusiveAccessBubble',
        '--no-first-run',
        '--mute-audio',
    ];
    if (process.env['SPECULUM_GL_FALLBACK'] === '1') {
        const extensionPath = path.resolve(__dirname, '../../../../sidecar/extensions/webgl-spoof');
        args.push('--use-gl=swiftshader');
        if (fs.existsSync(extensionPath)) {
            args.push(`--load-extension=${extensionPath}`, `--disable-extensions-except=${extensionPath}`);
        }
    }
    if (process.env['SPECULUM_IGNORE_CERT_ERRORS'] === '1') {
        args.push('--ignore-certificate-errors');
    }
    return args;
}
async function launchChrome(args) {
    const device = (0, device_emulation_1.normalizeDevice)(args.device);
    const userDataDir = profileDirForSession(args.sessionId);
    if (!args.preserveUserDataDir) {
        try {
            fs.rmSync(userDataDir, { recursive: true, force: true });
        }
        catch {
            /* best-effort */
        }
    }
    const context = await patchright_1.chromium.launchPersistentContext(userDataDir, {
        headless: false,
        executablePath: CHROME_EXECUTABLE,
        env: {
            ...process.env,
            DISPLAY: args.displayEnv,
        },
        args: buildChromeArgs(args.width, args.height),
        viewport: null,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        colorScheme: 'dark',
    });
    let page = context.pages()[0];
    if (!page)
        page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const { windowId } = (await cdp.send('Browser.getWindowForTarget', {}));
    await cdp.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'fullscreen' },
    });
    if (args.device) {
        await (0, device_emulation_1.applyDeviceEmulation)(cdp, args.width, args.height, device);
    }
    // No device profile: rely on window-size + fullscreen only (no Emulation override).
    return { context, page, cdp, userDataDir };
}
async function closeChrome(handle, options) {
    try {
        await handle.context.close();
    }
    catch {
        /* best-effort */
    }
    if (options?.removeUserDataDir === false)
        return;
    try {
        fs.rmSync(handle.userDataDir, { recursive: true, force: true });
    }
    catch {
        /* best-effort */
    }
}
/** Inject script tags into HTML by position (used by Navigation fetch fulfill). */
function injectScriptTags(html, scripts) {
    const groups = {
        HeaderTop: [],
        HeaderBottom: [],
        BodyTop: [],
        BodyBottom: [],
    };
    for (const s of scripts) {
        if (s.position in groups)
            groups[s.position].push(s);
    }
    const tag = (s) => {
        const typeAttr = s.type === 'Module' ? ' type="module"' : '';
        return `<script${typeAttr} src="${s.file}"></script>`;
    };
    let out = html;
    if (groups.HeaderTop.length) {
        out = out.replace(/<head[^>]*>/i, (m) => m + groups.HeaderTop.map(tag).join(''));
    }
    if (groups.HeaderBottom.length) {
        out = out.replace(/<\/head>/i, groups.HeaderBottom.map(tag).join('') + '</head>');
    }
    if (groups.BodyTop.length) {
        out = out.replace(/<body[^>]*>/i, (m) => m + groups.BodyTop.map(tag).join(''));
    }
    if (groups.BodyBottom.length) {
        out = out.replace(/<\/body>/i, groups.BodyBottom.map(tag).join('') + '</body>');
    }
    return out;
}
//# sourceMappingURL=ChromeRuntime.js.map