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
exports.webglSpoofExtensionPath = webglSpoofExtensionPath;
exports.buildChromeArgs = buildChromeArgs;
exports.launchChrome = launchChrome;
exports.ensureChromeXFocus = ensureChromeXFocus;
exports.closeChrome = closeChrome;
exports.injectScriptTags = injectScriptTags;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const patchright_1 = require("patchright");
const device_emulation_1 = require("./device-emulation");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function escapeHtmlAttr(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
function requireChromeExecutable() {
    const path = process.env['CHROME_EXECUTABLE'];
    if (!path?.trim()) {
        throw new Error('CHROME_EXECUTABLE environment variable is required');
    }
    return path.trim();
}
function profileDirForSession(sessionId) {
    return path.join(os.tmpdir(), 'speculum-profiles', sessionId);
}
/** Path to webgl-spoof from compiled `dist/browser/patchright` (and Docker `/app`). */
function webglSpoofExtensionPath() {
    return path.resolve(__dirname, '../../../extensions/webgl-spoof');
}
/**
 * Chrome launch flags. WebGL is always enabled with automatic backend selection:
 * real GPU when present, SwiftShader software fallback otherwise (no env knobs).
 * Kit UNMASKED spoof is applied in-page via device-kits init script.
 */
function buildChromeArgs(width, height) {
    // Chrome ≥137 may ignore --load-extension unless this feature is disabled.
    const disableFeatures = [
        'ExclusiveAccessBubble',
        'DisableLoadExtensionCommandLineSwitch',
    ];
    const extensionPath = webglSpoofExtensionPath();
    if (!fs.existsSync(extensionPath)) {
        throw Object.assign(new Error(`webgl-spoof extension missing at ${extensionPath}`), { code: 'FAILED_PRECONDITION', errorCode: 'webgl_spoof_missing', phase: 'launch' });
    }
    const args = [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        `--window-size=${width},${height}`,
        '--window-position=0,0',
        `--disable-features=${disableFeatures.join(',')}`,
        '--touch-events=enabled',
        '--no-first-run',
        '--mute-audio',
        // §5.3.4 bans background-throttling of the frame clock: a backgrounded/occluded
        // tab must keep emitting at frameRateHz, or the watchdog fires falsely and the
        // client silently lags. These three flags remove Chrome's own throttling paths.
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        // Prefer hardware ANGLE when available; allow SwiftShader when not.
        '--use-gl=angle',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--enable-unsafe-swiftshader',
        `--load-extension=${extensionPath}`,
        `--disable-extensions-except=${extensionPath}`,
    ];
    if (process.env['SPECULUM_IGNORE_CERT_ERRORS'] === '1') {
        args.push('--ignore-certificate-errors');
    }
    return args;
}
async function launchChrome(args) {
    if (!Number.isFinite(args.width) || !Number.isFinite(args.height) || args.width <= 0 || args.height <= 0) {
        throw Object.assign(new Error('launch requires positive width and height'), {
            code: 'INVALID_ARGUMENT',
        });
    }
    if (!args.locale.trim() || !args.language.trim() || !args.timeZoneId.trim() || !args.colorScheme) {
        throw Object.assign(new Error('launch requires locale, language, timeZoneId, and colorScheme'), {
            code: 'INVALID_ARGUMENT',
        });
    }
    const chromeExecutable = requireChromeExecutable();
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
        executablePath: chromeExecutable,
        env: {
            ...process.env,
            DISPLAY: args.displayEnv,
        },
        args: buildChromeArgs(args.width, args.height),
        viewport: null,
        locale: args.locale,
        timezoneId: args.timeZoneId,
        colorScheme: args.colorScheme,
        extraHTTPHeaders: {
            'Accept-Language': args.language,
        },
    });
    let page = context.pages()[0];
    if (!page)
        page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (args.geolocation) {
        await cdp.send('Emulation.setGeolocationOverride', {
            latitude: args.geolocation.latitude,
            longitude: args.geolocation.longitude,
            accuracy: args.geolocation.accuracy,
        });
    }
    // Native window at logical W×H + device metrics (no fullscreen — that left
    // mobile cssLayoutViewport stuck at the legacy ~980px width).
    await (0, device_emulation_1.applyLogicalViewport)(cdp, args.width, args.height, args.device, context);
    await ensureChromeXFocus(args.displayEnv);
    return { context, page, cdp, userDataDir };
}
/** Best-effort: raise Chrome so OS CorePointer/CoreKeyboard events hit the window. */
async function ensureChromeXFocus(displayEnv) {
    const env = { ...process.env, DISPLAY: displayEnv };
    const classes = ['Google-chrome', 'google-chrome', 'Chromium', 'chromium'];
    for (const cls of classes) {
        try {
            await execFileAsync('xdotool', ['search', '--onlyvisible', '--class', cls, 'windowactivate', '--sync'], { env, timeout: 2_000 });
            return;
        }
        catch {
            /* try next class */
        }
    }
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
        const raw = s.remoteUrl && s.remoteUrl.length > 0 ? s.remoteUrl : s.file;
        const src = escapeHtmlAttr(raw);
        return `<script${typeAttr} src="${src}"></script>`;
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