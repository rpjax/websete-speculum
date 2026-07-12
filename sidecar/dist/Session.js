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
exports.Session = void 0;
const fs = __importStar(require("fs"));
const BrowserManager_1 = require("./BrowserManager");
const ScreencastCapture_1 = require("./ScreencastCapture");
const AsyncChain_1 = require("./AsyncChain");
const MouseMoveCoalescer_1 = require("./MouseMoveCoalescer");
const NavigationGeneration_1 = require("./NavigationGeneration");
const ResizeGuard_1 = require("./ResizeGuard");
const ProfileArchive_1 = require("./ProfileArchive");
const Protocol_1 = require("./Protocol");
// ── Constants ─────────────────────────────────────────────────────────────────
/** Maps Log.entryAdded severity strings to wire-level level bytes. */
const LOG_LEVEL = { verbose: 0, info: 3, warning: 1, error: 2 };
/** Maps DOM MouseEvent.button (0=left, 1=middle, 2=right) → Playwright button name. */
function domButton(b) {
    if (b === 1)
        return 'middle';
    if (b === 2)
        return 'right';
    return 'left';
}
/**
 * Represents one complete browser session:
 *   Xvfb display → Chrome (non-headless) → CDP Page.startScreencast → JPEG WS frames
 *   binary WS input → CDP mouse/keyboard → Chrome
 *
 * Lifecycle:
 *   Session.create() → send frames → handleMessage() for input
 *   dispose() → stops screencast → closes browser → kills Xvfb
 */
class Session {
    sessionId;
    _ws;
    _display;
    _context;
    _page;
    _cdp;
    _capture;
    _width;
    _height;
    /**
     * The frame callback wired to the WebSocket send logic.
     * Stored so ScreencastCapture.restart() can reuse it on resize.
     */
    _onFrame;
    /** Guard that prevents concurrent resize operations. */
    _resizeGuard = new ResizeGuard_1.ResizeGuard();
    /** Monotonic token — stale navigations are discarded after completion. */
    _navigation = new NavigationGeneration_1.NavigationGeneration();
    /** True while profile snapshot is being captured. */
    _snapshotting = false;
    /** Latest-wins coalesce buffer for mousemove. */
    _mouseMoveCoalescer;
    /** Whether the JsBridge (console forwarding + evaljs) is active. */
    _jsBridgeEnabled;
    /** Interval handle for the 1 s status publisher. Cleared in dispose(). */
    _statusInterval = null;
    _userDataDir;
    _disposed = false;
    _browserQuiesced = false;
    constructor(sessionId, ws, display, context, page, cdp, capture, width, height, onFrame, jsBridgeEnabled, userDataDir) {
        this.sessionId = sessionId;
        this._ws = ws;
        this._display = display;
        this._context = context;
        this._page = page;
        this._cdp = cdp;
        this._capture = capture;
        this._width = width;
        this._height = height;
        this._onFrame = onFrame;
        this._jsBridgeEnabled = jsBridgeEnabled;
        this._userDataDir = userDataDir;
        this._mouseMoveCoalescer = new MouseMoveCoalescer_1.MouseMoveCoalescer((x, y) => {
            if (this._snapshotting || this._disposed)
                return;
            this._page.mouse.move(x, y).catch(() => { });
        });
    }
    // ── Factory ───────────────────────────────────────────────────────────────
    static async create(sessionId, ws, display, width, height, url, scripts = [], jsBridgeEnabled = false, allowedNavigationDomains, profileBlob) {
        console.log(`[${sessionId}] Launching Chrome on display ${display.displayEnv}`);
        let context;
        let cdp;
        let userDataDir = '';
        try {
            const handle = await (0, BrowserManager_1.launchBrowser)(sessionId, display.displayEnv, width, height, profileBlob);
            context = handle.context;
            cdp = handle.cdp;
            userDataDir = handle.userDataDir;
            const page = handle.page;
            await Session._setupSingleTabEnforcement(context);
            if (jsBridgeEnabled)
                await Session._setupJsBridge(cdp, ws, sessionId);
            Session._setupUrlSync(page, ws);
            Session._setupTabInterception(context, page, sessionId);
            if (scripts.length > 0) {
                // Bypass CSP so injected scripts execute regardless of page policy.
                try {
                    await cdp.send('Page.setBypassCSP', { enabled: true });
                }
                catch { /* best-effort */ }
            }
            // Unified CDP Fetch interception on our own CDPSession — handles
            // local script serving, navigation guard and HTML injection without
            // ever using page.route() for requests that hit the real network.
            if (scripts.length > 0 || (allowedNavigationDomains && allowedNavigationDomains.length > 0)) {
                await Session._setupFetchInterception(cdp, ws, sessionId, scripts, allowedNavigationDomains);
            }
            if (url) {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            }
            // ── Frame relay with in-flight back-pressure ──────────────────────
            // Allow at most MAX_IN_FLIGHT frames queued in the WS send buffer at
            // once.  If the .NET relay or the network is slow, inFlight hits the
            // cap and new frames are dropped rather than accumulating in memory.
            const MAX_IN_FLIGHT = 3;
            let inFlight = 0;
            const onFrame = (buf) => {
                if (ws.readyState !== ws.OPEN)
                    return;
                if (inFlight >= MAX_IN_FLIGHT)
                    return; // network backed up — drop
                inFlight++;
                ws.send(buf, { binary: true }, () => { inFlight--; });
            };
            const capture = await ScreencastCapture_1.ScreencastCapture.start(cdp, width, height, onFrame);
            console.log(`[${sessionId}] Session ready`);
            const session = new Session(sessionId, ws, display, context, page, cdp, capture, width, height, onFrame, jsBridgeEnabled, userDataDir);
            session._setupStatusPublisher();
            return session;
        }
        catch (err) {
            // Clean up partially-created resources on failure.
            try {
                await cdp?.detach();
            }
            catch { /* best-effort */ }
            try {
                await context?.close();
            }
            catch { /* best-effort */ }
            throw err;
        }
    }
    // ── Input dispatch ────────────────────────────────────────────────────────
    async handleMessage(raw) {
        if (this._snapshotting)
            return;
        const msg = (0, Protocol_1.decodeMessage)(raw);
        if (!msg || msg.type === 'create')
            return;
        try {
            switch (msg.type) {
                case 'navigate': {
                    const url = msg.url;
                    if (!url.startsWith('http://') && !url.startsWith('https://'))
                        break;
                    await this._runNavigation(() => this._page.goto(url, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30_000,
                    }));
                    break;
                }
                case 'refresh':
                    await this._runNavigation(() => this._page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }));
                    break;
                // ── Pointer — CDP Input.dispatchMouseEvent ───────────────────
                // Injects events into Chrome's rendering pipeline (JS events,
                // :hover states, clicks) without requiring X11 focus.  The cursor
                // is rendered client-side as a software overlay on the canvas.
                case 'mousemove':
                    this._queueMouseMove(msg.x, msg.y);
                    break;
                case 'mousedown':
                    await this._page.mouse.move(msg.x, msg.y);
                    await this._page.mouse.down({ button: domButton(msg.button) });
                    break;
                case 'mouseup':
                    await this._page.mouse.move(msg.x, msg.y);
                    await this._page.mouse.up({ button: domButton(msg.button) });
                    break;
                case 'wheel':
                    await this._page.mouse.move(msg.x, msg.y);
                    await this._page.mouse.wheel(msg.deltaX, msg.deltaY);
                    break;
                // ── Keyboard — CDP Input.dispatchKeyEvent ────────────────────
                // Works even without X11 focus (once mouse moved via CDP, Chrome's
                // X11 window loses X11 focus so xdotool keystrokes are dropped).
                case 'keydown':
                    // keyboard.down/up accepts ASCII printable chars and named DOM
                    // keys ("Enter", "Shift", …).  Non-ASCII chars (ç, é, ã, CJK…)
                    // must go through keyboard.type() which accepts any Unicode point.
                    if (msg.key.length === 1 && msg.key.charCodeAt(0) > 127) {
                        await this._page.keyboard.type(msg.key);
                    }
                    else {
                        await this._page.keyboard.down(msg.key);
                    }
                    break;
                case 'keyup':
                    // Skip keyup for non-ASCII — the matching keydown already handled
                    // the full press cycle via keyboard.type().
                    if (msg.key.length === 1 && msg.key.charCodeAt(0) > 127)
                        break;
                    await this._page.keyboard.up(msg.key);
                    break;
                case 'type':
                    await this._page.keyboard.type(msg.text);
                    break;
                case 'goback':
                    await this._runNavigation(() => this._page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }));
                    break;
                case 'goforward':
                    await this._runNavigation(() => this._page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }));
                    break;
                case 'evaljs':
                    if (this._jsBridgeEnabled)
                        await this._handleEvalJs(msg.id, msg.code);
                    break;
                case 'resize':
                    await this._handleResize(msg.width, msg.height);
                    break;
            }
        }
        catch (err) {
            // Malformed or late input — ignore.
            console.warn(`[${this.sessionId}] Input error (${msg.type}):`, err.message);
        }
    }
    _queueMouseMove(x, y) {
        if (this._snapshotting)
            return;
        this._mouseMoveCoalescer.queue(x, y);
    }
    async _runNavigation(action) {
        const generation = this._navigation.begin();
        try {
            await action();
            if (!this._navigation.isCurrent(generation))
                return;
        }
        catch (err) {
            if (this._navigation.isCurrent(generation)) {
                console.warn(`[${this.sessionId}] Navigation error:`, err.message);
            }
        }
    }
    // ── Disposal ──────────────────────────────────────────────────────────────
    async captureSnapshot() {
        this._snapshotting = true;
        console.log(`[${this.sessionId}] Capturing profile snapshot from ${this._userDataDir}`);
        if (this._statusInterval !== null) {
            clearInterval(this._statusInterval);
            this._statusInterval = null;
        }
        try {
            await this._capture.stop();
        }
        catch { /* already stopped */ }
        if (!this._browserQuiesced) {
            try {
                await this._cdp.detach();
            }
            catch { /* best-effort */ }
            try {
                await this._context.close();
            }
            catch { /* best-effort */ }
            this._browserQuiesced = true;
        }
        const blob = await (0, ProfileArchive_1.archiveProfile)(this._userDataDir);
        if (this._ws.readyState === this._ws.OPEN) {
            (0, ProfileArchive_1.sendProfileChunks)(this._ws, blob);
            this._ws.send(JSON.stringify({ type: 'snapshotDone', byteSize: blob.length }));
        }
        return blob.length;
    }
    async dispose() {
        if (this._disposed)
            return;
        this._disposed = true;
        // Stop the status publisher immediately so no more frames are sent
        // during the teardown window.
        if (this._statusInterval !== null) {
            clearInterval(this._statusInterval);
            this._statusInterval = null;
        }
        console.log(`[${this.sessionId}] Disposing session`);
        // 1. Stop the CDP screencast — no more frames will be sent after this.
        try {
            await this._capture.stop();
        }
        catch { /* already stopped */ }
        // 2. Close Chrome and kill the virtual display in parallel.
        await Promise.allSettled([
            (async () => {
                if (!this._browserQuiesced) {
                    try {
                        await this._cdp.detach();
                    }
                    catch { /* already detached */ }
                    try {
                        await this._context.close();
                    }
                    catch { /* already closed   */ }
                }
            })(),
            this._display.dispose().catch(() => { }),
        ]);
        try {
            fs.rmSync(this._userDataDir, { recursive: true, force: true });
        }
        catch { /* best-effort */ }
    }
    // ── Private handlers ─────────────────────────────────────────────────────
    /**
     * Evaluates arbitrary JS in the page's main execution context and sends
     * the result back as a MSG_EVAL_RESULT (0x06) frame.
     *
     * ⚠ Uses Runtime.evaluate on our own CDPSession (not page.evaluate()) so that
     *   console.* calls from the evaluated code are delivered to our session's
     *   Runtime.consoleAPICalled handler and forwarded via the JsBridge.
     *   page.evaluate() runs in the isolated utility world where console calls
     *   are not routed to our listener.
     */
    async _handleEvalJs(id, code) {
        let ok = true;
        let value = '';
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const res = await this._cdp.send('Runtime.evaluate', {
                expression: Session._wrapEval(code),
                returnByValue: true,
                awaitPromise: true,
                timeout: 10_000,
            });
            if (res.exceptionDetails) {
                // The wrapper IIFE itself threw — should not happen.
                ok = false;
                value = res.exceptionDetails.text ?? 'Evaluation error';
            }
            else {
                const r = res.result?.value;
                if (!r) {
                    value = '';
                }
                else if (r.ok) {
                    value = r.v ?? '';
                }
                else {
                    ok = false;
                    value = r.v ?? 'Unknown error';
                }
            }
        }
        catch (err) {
            ok = false;
            value = err.message;
        }
        if (this._ws.readyState === this._ws.OPEN) {
            this._ws.send((0, Protocol_1.encodeEvalResult)(id, ok, value), { binary: true });
        }
    }
    /**
     * Resizes the virtual viewport and restarts the screencast at new dimensions.
     *
     * Resize is pure CDP — no Xvfb or WM interaction required:
     *   1. setDeviceMetricsOverride — tells Chrome's renderer the new viewport size.
     *   2. ScreencastCapture.restart — stop + startScreencast with new size hints.
     *
     * A _resizing guard prevents overlapping resize operations (client debounces
     * at 250 ms; guard is a safety net for any race that slips through).
     */
    async _handleResize(w, h) {
        if (!this._resizeGuard.tryBegin())
            return;
        if (w === this._width && h === this._height) {
            this._resizeGuard.end();
            return;
        }
        if (w < 100 || h < 100) {
            this._resizeGuard.end();
            return;
        }
        try {
            console.log(`[${this.sessionId}] Resize → ${w}×${h}`);
            try {
                await this._cdp.send('Emulation.setDeviceMetricsOverride', {
                    width: w, height: h,
                    deviceScaleFactor: 1,
                    mobile: false,
                });
            }
            catch { /* CDP session may have been recycled — best-effort */ }
            await this._capture.restart(w, h, this._onFrame);
            this._width = w;
            this._height = h;
            console.log(`[${this.sessionId}] Resize complete → ${w}×${h}`);
        }
        catch (err) {
            console.error(`[${this.sessionId}] Resize failed:`, err.message);
        }
        finally {
            this._resizeGuard.end();
        }
    }
    // ── Private status publisher ──────────────────────────────────────────────
    /**
     * Starts a 1 s interval that sends a MSG_STATUS (0x09) frame to .NET.
     * .NET intercepts the frame, augments it with fps/uptime, and forwards
     * it to the client via a dedicated SignalR channel — the existing frame
     * and console channels are untouched.
     *
     * Called once at the end of create() on the newly constructed instance.
     * Private members are accessible from the static create() in TypeScript.
     */
    _setupStatusPublisher() {
        this._statusInterval = setInterval(() => this._sendStatus(), 1_000);
    }
    _sendStatus() {
        if (this._ws.readyState !== this._ws.OPEN)
            return;
        try {
            this._ws.send((0, Protocol_1.encodeStatusFrame)({
                tabCount: this._context.pages().length,
                url: this._page.url(),
                resizing: this._resizeGuard.isActive,
                width: this._width,
                height: this._height,
            }), { binary: true });
        }
        catch { /* WS closed mid-send — interval cleared in dispose() */ }
    }
    // ── Private setup helpers ─────────────────────────────────────────────────
    /**
     * Installs single-tab enforcement on the browser context (Layer 1).
     *
     * Applied via context.addInitScript so it runs on ALL pages, including pages
     * created before context.on('page') can close them.  Called before page.goto()
     * so the initial navigation is also covered.
     *
     * What it does:
     *   • Nulls window.opener — prevents a popup from doing
     *     window.opener.location = '...' on the main tab (root cause of the
     *     "vai e vem" oscillation bug).
     *   • Overrides window.open() to redirect in the current tab.
     *   • Intercepts target="_blank" anchor clicks (capture phase) and converts
     *     them to same-tab navigations.
     *   • Redirects target="_blank" form submissions to _self.
     *
     * _setupTabInterception() is the catch-all for browser-level popup mechanisms
     * that bypass JavaScript.
     */
    static async _setupSingleTabEnforcement(context) {
        await context.addInitScript(`
            (function () {
                'use strict';

                // Sever opener so popups cannot mutate the main tab's location.
                try {
                    Object.defineProperty(window, 'opener', {
                        value: null, writable: false, configurable: false,
                    });
                } catch (_) { /* already non-configurable */ }

                // window.open → in-place navigation.
                var _origOpen = window.open.bind(window);
                window.open = function speculum_open(url, target, features) {
                    var href = (url instanceof URL) ? url.href : String(url || '');
                    if (href &&
                        !href.startsWith('javascript:') &&
                        !href.startsWith('about:') &&
                        !href.startsWith('blob:')) {
                        window.location.href = href;
                        return null;
                    }
                    return _origOpen(url, target, features);
                };

                // target="_blank" / target="_new" anchor clicks → same-tab.
                // Capture phase fires before any site listener.
                document.addEventListener('click', function (e) {
                    if (e.defaultPrevented) return;
                    var el = e.target;
                    var a = el instanceof Element ? el.closest('a') : null;
                    if (!a) return;
                    var t = (a.getAttribute('target') || '').toLowerCase();
                    if (t !== '_blank' && t !== '_new') return;
                    var href = a.href;
                    if (!href ||
                        href.startsWith('javascript:') ||
                        href.startsWith('about:') ||
                        href.startsWith('blob:')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = href;
                }, true);

                // target="_blank" form submissions → _self.
                document.addEventListener('submit', function (e) {
                    var form = e.target instanceof HTMLFormElement ? e.target : null;
                    if (!form) return;
                    var t = (form.getAttribute('target') || '').toLowerCase();
                    if (t === '_blank' || t === '_new') {
                        form.setAttribute('target', '_self');
                    }
                }, true);
            })();
        `);
    }
    /**
     * Unified CDP Fetch interception on our own CDPSession — replaces page.route()
     * entirely for the three concerns below.  A single Fetch.enable call with
     * targeted patterns ensures Chrome always sees native requests; we only touch
     * things after they've already happened (or block them before they go out).
     *
     * ── Why not page.route() for local scripts ────────────────────────────────
     * When Playwright's internal session serves a script via route.fulfill(), Chrome
     * routes Runtime.consoleAPICalled events from that script's execution back to
     * Playwright's session — not ours.  By fulfilling the request on OUR CDPSession
     * instead, Chrome routes console events to us and they appear in VCON.
     *
     * ── Patterns and responsibility ───────────────────────────────────────────
     *
     *   requestStage:'Request'  + urlPattern per script
     *     → Local resource serving: match by pathname, fulfill from memory.
     *       No network request is ever made for these paths.
     *
     *   requestStage:'Request'  + resourceType:'Document'  (if allowedNavigationDomains set)
     *     → Navigation guard: check hostname, fail + MSG_REDIRECT if external.
     *       Allowed navigations continue natively (Fetch.continueRequest).
     *
     *   requestStage:'Response' + resourceType:'Document'  (if scripts configured)
     *     → HTML injection: receive native response body, inject <script> tags,
     *       fulfill with modified body.  Server always saw the real Chrome request.
     *
     * Everything that doesn't match a pattern → Chrome handles it natively, this
     * session is never involved, zero overhead.
     */
    static async _setupFetchInterception(cdp, ws, sessionId, scripts, allowedNavigationDomains) {
        const scriptMap = new Map(scripts.map(s => [s.file, s]));
        const hasScripts = scripts.length > 0;
        const hasGuard = !!allowedNavigationDomains && allowedNavigationDomains.length > 0;
        // Build the minimal set of Fetch patterns needed.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const patterns = [];
        // One pattern per local script path (request stage).
        // '*' prefix matches any origin so the same path works across sub-domains.
        for (const s of scripts) {
            patterns.push({ requestStage: 'Request', urlPattern: `*${s.file}*` });
        }
        // Document request stage → navigation guard.
        if (hasGuard) {
            patterns.push({ requestStage: 'Request', resourceType: 'Document' });
        }
        // Document response stage → HTML injection.
        if (hasScripts) {
            patterns.push({ requestStage: 'Response', resourceType: 'Document' });
        }
        await cdp.send('Fetch.enable', { patterns });
        // Resolve the main frame's ID so the navigation guard only applies to
        // top-level navigations.  Sub-frame document loads (ad SafeFrames, OAuth
        // pop-ups converted to iframes, etc.) must be allowed through even when
        // their origin is outside the upstream domain.
        let mainFrameId;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { frameTree } = await cdp.send('Page.getFrameTree', {});
            mainFrameId = frameTree?.frame?.id;
        }
        catch { /* best-effort — guard will be skipped for unresolved frames */ }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Page.frameNavigated', (event) => {
            const frame = event?.frame;
            if (frame && !frame.parentId)
                mainFrameId = frame.id;
        });
        const htmlInjectChain = new AsyncChain_1.AsyncChain();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Fetch.requestPaused', async (event) => {
            const { requestId, responseStatusCode, responseHeaders, request } = event;
            const url = request?.url ?? '';
            // ── Response stage: HTML injection ──────────────────────────────────
            if (responseStatusCode !== undefined) {
                // Redirects (3xx) have no body — pass through immediately.
                // Calling Fetch.getResponseBody on a redirect produces:
                //   "Can only get response body on requests captured after headers received."
                if (responseStatusCode >= 300 && responseStatusCode < 400) {
                    try {
                        await cdp.send('Fetch.continueResponse', { requestId });
                    }
                    catch { /* best-effort */ }
                    return;
                }
                // Only inject into the main frame's documents.
                // Sub-frame HTML (ad iframes, SafeFrames, OAuth frames, …) would
                // receive unnecessary script tags and generate spurious script requests
                // from third-party origins.
                if (mainFrameId && event.frameId !== mainFrameId) {
                    try {
                        await cdp.send('Fetch.continueResponse', { requestId });
                    }
                    catch { /* best-effort */ }
                    return;
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const ct = (responseHeaders ?? [])
                    .find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
                if (!ct.includes('text/html')) {
                    try {
                        await cdp.send('Fetch.continueResponse', { requestId });
                    }
                    catch { /* best-effort */ }
                    return;
                }
                try {
                    await htmlInjectChain.run(async () => {
                        const { body, base64Encoded } = await cdp.send('Fetch.getResponseBody', { requestId });
                        const html = base64Encoded
                            ? Buffer.from(body, 'base64').toString('utf-8')
                            : body;
                        const patched = Session._injectScriptTags(html, scripts);
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const headers = (responseHeaders ?? [])
                            .filter((h) => !['content-encoding', 'content-length']
                            .includes(h.name.toLowerCase()));
                        await cdp.send('Fetch.fulfillRequest', {
                            requestId,
                            responseCode: responseStatusCode,
                            responseHeaders: headers,
                            body: Buffer.from(patched, 'utf-8').toString('base64'),
                        });
                        console.log(`[${sessionId}] HTML injected: ${scripts.length} script tag(s)`);
                    });
                }
                catch (err) {
                    console.warn(`[${sessionId}] HTML injection failed:`, err.message);
                    try {
                        await cdp.send('Fetch.continueResponse', { requestId });
                    }
                    catch { /* best-effort */ }
                }
                return;
            }
            // ── Request stage ───────────────────────────────────────────────────
            // Local script serving — match on pathname so query strings are ignored.
            if (hasScripts && url) {
                try {
                    const { pathname } = new URL(url);
                    const script = scriptMap.get(pathname);
                    if (script) {
                        await cdp.send('Fetch.fulfillRequest', {
                            requestId,
                            responseCode: 200,
                            responseHeaders: [
                                { name: 'content-type', value: 'text/javascript; charset=utf-8' },
                                { name: 'cache-control', value: 'no-store' },
                            ],
                            body: Buffer.from(script.content, 'utf-8').toString('base64'),
                        });
                        console.log(`[${sessionId}] Served from memory: ${pathname}`);
                        return;
                    }
                }
                catch { /* invalid URL — fall through */ }
            }
            // Navigation guard — block Document requests that leave the upstream domain,
            // but ONLY for the main frame.  Sub-frame navigations (ad SafeFrames,
            // OAuth iframes, etc.) are legitimate page behaviour and must not be blocked
            // even when their destination is an external domain.
            if (hasGuard && url && (url.startsWith('http://') || url.startsWith('https://'))) {
                const isMainFrame = !mainFrameId || event.frameId === mainFrameId;
                if (isMainFrame) {
                    try {
                        const host = new URL(url).hostname;
                        if (!Session._matchesAllowedDomain(host, allowedNavigationDomains)) {
                            console.log(`[${sessionId}] Navigation blocked: '${host}' ∉ allowed domains → client redirect`);
                            if (ws.readyState === ws.OPEN)
                                ws.send((0, Protocol_1.encodeRedirectFrame)(url), { binary: true });
                            await cdp.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
                            return;
                        }
                    }
                    catch { /* malformed URL — fall through */ }
                }
            }
            // Allowed request — proceed natively.
            try {
                await cdp.send('Fetch.continueRequest', { requestId });
            }
            catch { /* best-effort */ }
        });
    }
    /**
     * Inserts `<script src>` (Classic) or `<script type="module" src>` (Module)
     * tags into an HTML string at the four configurable positions:
     *
     *   HeaderTop    → immediately after `<head>`
     *   HeaderBottom → immediately before `</head>`
     *   BodyTop      → immediately after `<body>`
     *   BodyBottom   → immediately before `</body>`
     *
     * Scripts at the same position preserve their declaration order.
     * The regex replacements are intentionally simple — they handle the vast
     * majority of real-world HTML. The script `src` values are synthetic
     * same-origin paths backed by in-memory script payloads and validated at startup.
     */
    static _injectScriptTags(html, scripts) {
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
        const toTag = (s) => s.type === 'Module'
            ? `<script type="module" src="${s.file}"></script>`
            : `<script src="${s.file}"></script>`;
        const block = (entries) => entries.map(toTag).join('\n');
        let result = html;
        const ht = block(groups.HeaderTop);
        const hb = block(groups.HeaderBottom);
        const bt = block(groups.BodyTop);
        const bb = block(groups.BodyBottom);
        if (ht)
            result = result.replace(/(<head\b[^>]*>)/i, `$1\n${ht}`);
        if (hb)
            result = result.replace(/(<\/head>)/i, `${hb}\n$1`);
        if (bt)
            result = result.replace(/(<body\b[^>]*>)/i, `$1\n${bt}`);
        if (bb)
            result = result.replace(/(<\/body>)/i, `${bb}\n$1`);
        return result;
    }
    /**
     * Enables Runtime + Log on our CDPSession and wires console forwarding to
     * the WebSocket as MSG_CONSOLE (0x05) frames.
     *
     * ── Why we listen on our CDPSession (not page.on('console')) ─────────────
     * page.on('console') listens on Playwright's internal CDP session.  When
     * evaljs runs code via Runtime.evaluate on OUR session, Chrome routes
     * Runtime.consoleAPICalled back to OUR session only — so page.on('console')
     * silently drops every console.* call produced by vcon().
     *
     * Runtime.consoleAPICalled captures JS console.* calls; Log.entryAdded
     * captures browser-level messages (network errors, CSP violations, etc.).
     */
    static async _setupJsBridge(cdp, ws, sessionId) {
        await cdp.send('Runtime.enable', {});
        await cdp.send('Log.enable', {});
        const sendConsole = (level, text) => {
            if (ws.readyState !== ws.OPEN)
                return;
            if (text.length > 65_536)
                text = text.slice(0, 65_536) + ' … [truncated]';
            ws.send((0, Protocol_1.encodeConsoleMessage)(level, text), { binary: true });
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Runtime.consoleAPICalled', (event) => {
            const level = Protocol_1.CONSOLE_LEVELS[event.type] ?? 0;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const text = event.args.map((arg) => {
                if (arg.type === 'undefined')
                    return 'undefined';
                if (arg.unserializableValue !== undefined)
                    return String(arg.unserializableValue);
                if (arg.value !== undefined)
                    return typeof arg.value === 'string'
                        ? arg.value
                        : JSON.stringify(arg.value);
                return String(arg.description ?? '');
            }).join(' ');
            sendConsole(level, text);
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Log.entryAdded', (event) => {
            const entry = event.entry;
            sendConsole(LOG_LEVEL[entry.level] ?? 0, entry.text);
        });
        console.log(`[${sessionId}] JsBridge console forwarding active`);
    }
    /**
     * Sends the current URL to the client as a MSG_URL (0x04) frame whenever
     * the main frame navigates.
     *
     * Registered before page.goto() so the initial navigation is captured.
     * Only http/https URLs are forwarded; about:, chrome:, etc. are dropped.
     */
    static _setupUrlSync(page, ws) {
        page.on('framenavigated', (frame) => {
            if (frame !== page.mainFrame())
                return;
            const currentUrl = page.url();
            if (!/^https?:\/\//i.test(currentUrl))
                return;
            if (ws.readyState !== ws.OPEN)
                return;
            ws.send((0, Protocol_1.encodeUrlUpdate)(currentUrl), { binary: true });
        });
    }
    /**
     * Catches any new tab that Layer 1 did not prevent (browser-level popup
     * mechanisms that bypass JavaScript) and redirects the main tab to the
     * target URL (Layer 2 catch-all).
     *
     * Registered before page.goto() so popups opened during the initial load
     * are also caught.
     *
     * Policy: close the extra tab as soon as its URL leaves about:blank, then
     * navigate the main tab to the target.  waitForURL is used instead of
     * waitForLoadState so the extra tab is closed in ~50–200 ms rather than
     * waiting up to 5 s for DOMContentLoaded.
     *
     * Chrome-extension:// and chrome:// pages are ignored — they are internal
     * browser infrastructure, not user-initiated tabs.
     */
    static _setupTabInterception(context, page, sessionId) {
        context.on('page', (newPage) => {
            if (newPage === page)
                return;
            (async () => {
                let targetUrl = null;
                try {
                    await newPage.waitForURL((u) => u.protocol !== 'about:' && u.protocol !== 'chrome:', { timeout: 2_000 });
                    targetUrl = newPage.url();
                }
                catch {
                    try {
                        targetUrl = newPage.url();
                    }
                    catch { /* page gone */ }
                }
                try {
                    await newPage.close();
                }
                catch { /* already closed */ }
                if (!targetUrl ||
                    targetUrl.startsWith('about:') ||
                    targetUrl.startsWith('chrome:') ||
                    targetUrl.startsWith('chrome-extension://')) {
                    return;
                }
                if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))
                    return;
                console.log(`[${sessionId}] Extra tab intercepted → navigating main tab to ${targetUrl}`);
                try {
                    await page.goto(targetUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30_000,
                    });
                }
                catch { /* navigation error — main tab may have already moved */ }
            })().catch(err => {
                console.warn(`[${sessionId}] Tab-interception error:`, err.message);
            });
        });
    }
    /**
     * Returns true when <paramref name="host"/> matches at least one pattern.
     * Wildcard patterns use the form `*.example.com` (does not match apex).
     */
    static _matchesAllowedDomain(host, patterns) {
        const normalizedHost = host.toLowerCase();
        for (const pattern of patterns) {
            if (!pattern)
                continue;
            const normalizedPattern = pattern.toLowerCase();
            if (normalizedPattern.startsWith('*.')) {
                const suffix = normalizedPattern.slice(2);
                if (normalizedHost.endsWith('.' + suffix))
                    return true;
            }
            else if (normalizedHost === normalizedPattern) {
                return true;
            }
        }
        return false;
    }
    // ── Private utility ───────────────────────────────────────────────────────
    /**
     * Wraps user code in an async IIFE suitable for Runtime.evaluate.
     *
     *   • (0,eval) runs at global scope (access to window, document, etc.).
     *   • If the result is a thenable it is awaited — so `await vcon("await fetch(…)")`
     *     resolves the value, not a plain Promise object.
     *   • Returns { ok, v } so errors travel through the result value rather than
     *     CDP exceptionDetails (avoids parsing the exception description).
     *   • v is null for undefined results (undefined is not JSON-serialisable
     *     across the CDP boundary).
     *   • awaitPromise:true on the Runtime.evaluate call tells CDP to await the
     *     async IIFE before resolving.
     */
    static _wrapEval(code) {
        return (`(async function(){try{`
            + `var __r=(0,eval)(${JSON.stringify(code)});`
            + `if(__r&&typeof __r.then==='function')__r=await __r;`
            + `return{ok:true,v:__r===undefined?null:`
            + `(function(){try{return JSON.stringify(__r)}catch(_){return String(__r)}})()}`
            + `}catch(e){return{ok:false,v:e.message||String(e)}}})() `);
    }
}
exports.Session = Session;
