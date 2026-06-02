import { WebSocket } from 'ws';
import { BrowserContext, Page, CDPSession } from 'patchright';
import { DisplayManager }    from './DisplayManager';
import { launchBrowser }     from './BrowserManager';
import { ScreencastCapture } from './ScreencastCapture';
import {
    decodeMessage,
    encodeUrlUpdate,
    encodeConsoleMessage,
    encodeEvalResult,
    CONSOLE_LEVELS,
    ScriptEntry,
} from './Protocol';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maps ScriptEntry.position to a numeric sort key so scripts are injected
 * in the correct DOM order when multiple entries are declared.
 */
const POSITION_ORDER: Record<string, number> = {
    HeaderTop:    0,
    HeaderBottom: 1,
    BodyTop:      2,
    BodyBottom:   3,
};

/** Maps Log.entryAdded severity strings to wire-level level bytes. */
const LOG_LEVEL: Record<string, number> = { verbose: 0, info: 3, warning: 1, error: 2 };

/** Maps DOM MouseEvent.button (0=left, 1=middle, 2=right) → Playwright button name. */
function domButton(b: number): 'left' | 'middle' | 'right' {
    if (b === 1) return 'middle';
    if (b === 2) return 'right';
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
export class Session {
    readonly sessionId: string;

    private _ws:       WebSocket;
    private _display:  DisplayManager;
    private _context:  BrowserContext;
    private _page:     Page;
    private _cdp:      CDPSession;
    private _capture:  ScreencastCapture;
    private _width:    number;
    private _height:   number;

    /**
     * The frame callback wired to the WebSocket send logic.
     * Stored so ScreencastCapture.restart() can reuse it on resize.
     */
    private _onFrame: (buf: Buffer) => void;

    /** Guard that prevents concurrent resize operations. */
    private _resizing: boolean = false;

    /** Whether the JsBridge (console forwarding + evaljs) is active. */
    private _jsBridgeEnabled: boolean;

    private _disposed: boolean = false;

    private constructor(
        sessionId:       string,
        ws:              WebSocket,
        display:         DisplayManager,
        context:         BrowserContext,
        page:            Page,
        cdp:             CDPSession,
        capture:         ScreencastCapture,
        width:           number,
        height:          number,
        onFrame:         (buf: Buffer) => void,
        jsBridgeEnabled: boolean,
    ) {
        this.sessionId        = sessionId;
        this._ws              = ws;
        this._display         = display;
        this._context         = context;
        this._page            = page;
        this._cdp             = cdp;
        this._capture         = capture;
        this._width           = width;
        this._height          = height;
        this._onFrame         = onFrame;
        this._jsBridgeEnabled = jsBridgeEnabled;
    }

    // ── Factory ───────────────────────────────────────────────────────────────

    static async create(
        sessionId:       string,
        ws:              WebSocket,
        display:         DisplayManager,
        width:           number,
        height:          number,
        url?:            string,
        scripts:         ScriptEntry[] = [],
        jsBridgeEnabled: boolean       = false,
    ): Promise<Session> {
        console.log(`[${sessionId}] Launching Chrome on display ${display.displayEnv}`);

        let context: BrowserContext | undefined;
        let cdp: CDPSession | undefined;
        try {
            const handle = await launchBrowser(display.displayEnv, width, height);
            context = handle.context;
            cdp     = handle.cdp;
            const page = handle.page;

            await Session._setupSingleTabEnforcement(context);
            const injectAll = await Session._buildScriptInjector(cdp, page, scripts, sessionId);
            if (jsBridgeEnabled) await Session._setupJsBridge(cdp, ws, sessionId);
            Session._setupUrlSync(page, ws);
            Session._setupTabInterception(context, page, sessionId);

            if (url) {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            }

            // Inject scripts into the main world after the initial navigation so
            // Runtime.evaluate targets a live execution context (not about:blank).
            if (injectAll) await injectAll();

            // ── Frame relay with in-flight back-pressure ──────────────────────
            // Allow at most MAX_IN_FLIGHT frames queued in the WS send buffer at
            // once.  If the .NET relay or the network is slow, inFlight hits the
            // cap and new frames are dropped rather than accumulating in memory.
            const MAX_IN_FLIGHT = 3;
            let   inFlight      = 0;

            const onFrame = (buf: Buffer): void => {
                if (ws.readyState !== ws.OPEN) return;
                if (inFlight >= MAX_IN_FLIGHT)   return; // network backed up — drop
                inFlight++;
                ws.send(buf, { binary: true }, () => { inFlight--; });
            };

            const capture = await ScreencastCapture.start(cdp, width, height, onFrame);

            console.log(`[${sessionId}] Session ready`);

            return new Session(
                sessionId, ws, display, context, page, cdp,
                capture, width, height, onFrame, jsBridgeEnabled,
            );
        } catch (err) {
            // Clean up partially-created resources on failure.
            try { await cdp?.detach(); }     catch { /* best-effort */ }
            try { await context?.close(); }  catch { /* best-effort */ }
            throw err;
        }
    }

    // ── Input dispatch ────────────────────────────────────────────────────────

    async handleMessage(raw: string): Promise<void> {
        const msg = decodeMessage(raw);
        if (!msg || msg.type === 'create') return;

        try {
            switch (msg.type) {
                case 'navigate':
                    await this._page.goto(msg.url, {
                        waitUntil: 'domcontentloaded',
                        timeout:   30_000,
                    });
                    break;

                case 'refresh':
                    await this._page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
                    break;

                // ── Pointer — CDP Input.dispatchMouseEvent ───────────────────
                // Injects events into Chrome's rendering pipeline (JS events,
                // :hover states, clicks) without requiring X11 focus.  The cursor
                // is rendered client-side as a software overlay on the canvas.

                case 'mousemove':
                    this._page.mouse.move(msg.x, msg.y).catch(() => {});
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
                    } else {
                        await this._page.keyboard.down(msg.key);
                    }
                    break;

                case 'keyup':
                    // Skip keyup for non-ASCII — the matching keydown already handled
                    // the full press cycle via keyboard.type().
                    if (msg.key.length === 1 && msg.key.charCodeAt(0) > 127) break;
                    await this._page.keyboard.up(msg.key);
                    break;

                case 'type':
                    await this._page.keyboard.type(msg.text);
                    break;

                case 'goback':
                    await this._page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 });
                    break;

                case 'goforward':
                    await this._page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 });
                    break;

                case 'evaljs':
                    if (this._jsBridgeEnabled) await this._handleEvalJs(msg.id, msg.code);
                    break;

                case 'resize':
                    await this._handleResize(msg.width, msg.height);
                    break;
            }
        } catch (err) {
            // Malformed or late input — ignore.
            console.warn(`[${this.sessionId}] Input error (${msg.type}):`, (err as Error).message);
        }
    }

    // ── Disposal ──────────────────────────────────────────────────────────────

    async dispose(): Promise<void> {
        if (this._disposed) return;
        this._disposed = true;

        console.log(`[${this.sessionId}] Disposing session`);

        // 1. Stop the CDP screencast — no more frames will be sent after this.
        try { await this._capture.stop(); } catch { /* already stopped */ }

        // 2. Close Chrome and kill the virtual display in parallel.
        //    Running them concurrently reduces disposal time from ~5–8 s to ~1–2 s.
        await Promise.allSettled([
            (async () => {
                try { await this._cdp.detach(); }    catch { /* already detached */ }
                try { await this._context.close(); } catch { /* already closed   */ }
            })(),
            this._display.dispose().catch(() => { /* best-effort */ }),
        ]);
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
    private async _handleEvalJs(id: number, code: string): Promise<void> {
        let ok    = true;
        let value = '';

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const res: any = await this._cdp.send('Runtime.evaluate', {
                expression:    Session._wrapEval(code),
                returnByValue: true,
                awaitPromise:  true,
                timeout:       10_000,
            });

            if (res.exceptionDetails) {
                // The wrapper IIFE itself threw — should not happen.
                ok    = false;
                value = res.exceptionDetails.text ?? 'Evaluation error';
            } else {
                const r = res.result?.value as { ok: boolean; v: string | null } | undefined;
                if (!r) {
                    value = '';
                } else if (r.ok) {
                    value = r.v ?? '';
                } else {
                    ok    = false;
                    value = r.v ?? 'Unknown error';
                }
            }
        } catch (err) {
            ok    = false;
            value = (err as Error).message;
        }

        if (this._ws.readyState === this._ws.OPEN) {
            this._ws.send(encodeEvalResult(id, ok, value), { binary: true });
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
    private async _handleResize(w: number, h: number): Promise<void> {
        if (this._resizing) return;
        if (w === this._width && h === this._height) return; // no-op
        if (w < 100 || h < 100) return;                     // absurdly small — ignore

        this._resizing = true;
        try {
            console.log(`[${this.sessionId}] Resize → ${w}×${h}`);

            try {
                await this._cdp.send('Emulation.setDeviceMetricsOverride', {
                    width: w, height: h,
                    deviceScaleFactor: 1,
                    mobile: false,
                });
            } catch { /* CDP session may have been recycled — best-effort */ }

            await this._capture.restart(w, h, this._onFrame);

            this._width  = w;
            this._height = h;
            console.log(`[${this.sessionId}] Resize complete → ${w}×${h}`);
        } catch (err) {
            console.error(`[${this.sessionId}] Resize failed:`, (err as Error).message);
        } finally {
            this._resizing = false;
        }
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
    private static async _setupSingleTabEnforcement(context: BrowserContext): Promise<void> {
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
     * Builds an `injectAll` closure that evaluates each script in the main world
     * via Runtime.evaluate, then wires it to `page.on('load')` for re-injection
     * on every subsequent navigation.
     *
     * Returns null when scripts is empty.
     *
     * ── Why Runtime.evaluate (not addInitScript) ─────────────────────────────
     * All Playwright/Patchright injection mechanisms route scripts into the
     * isolated utility world (__playwright_utility_world__).  Globals set there
     * are invisible to page code in the main world.  Runtime.evaluate on our own
     * CDPSession is the only confirmed main-world execution path — omitting
     * contextId defaults to the page's main execution context.
     */
    private static async _buildScriptInjector(
        cdp:       CDPSession,
        page:      Page,
        scripts:   ScriptEntry[],
        sessionId: string,
    ): Promise<(() => Promise<void>) | null> {
        if (scripts.length === 0) return null;

        // Disable CSP so resources loaded by injected scripts (dynamic import,
        // fetch, etc.) are not blocked.
        try { await cdp.send('Page.setBypassCSP', { enabled: true }); } catch { /* best-effort */ }

        const sorted = [...scripts].sort(
            (a, b) =>
                (POSITION_ORDER[a.position] ?? 99) -
                (POSITION_ORDER[b.position] ?? 99),
        );

        const injectAll = async (): Promise<void> => {
            for (const s of sorted) {
                try {
                    await cdp.send('Runtime.evaluate', {
                        expression:    s.content,
                        returnByValue: false,
                        silent:        true,
                    });
                    console.log(`[${sessionId}] Injected: ${s.file}`);
                } catch (err) {
                    console.warn(
                        `[${sessionId}] Injection failed (${s.file}):`,
                        (err as Error).message,
                    );
                }
            }
        };

        // Re-inject on every subsequent navigation so scripts survive redirects
        // and full-page reloads.
        page.on('load', () => {
            injectAll().catch(err =>
                console.warn(`[${sessionId}] Re-injection error:`, (err as Error).message),
            );
        });

        return injectAll;
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
    private static async _setupJsBridge(
        cdp:       CDPSession,
        ws:        WebSocket,
        sessionId: string,
    ): Promise<void> {
        await cdp.send('Runtime.enable', {});
        await cdp.send('Log.enable',     {});

        const sendConsole = (level: number, text: string): void => {
            if (ws.readyState !== ws.OPEN) return;
            if (text.length > 65_536) text = text.slice(0, 65_536) + ' … [truncated]';
            ws.send(encodeConsoleMessage(level, text), { binary: true });
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Runtime.consoleAPICalled', (event: any) => {
            const level = CONSOLE_LEVELS[event.type as string] ?? 0;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const text = (event.args as any[]).map((arg: any): string => {
                if (arg.type === 'undefined')              return 'undefined';
                if (arg.unserializableValue !== undefined) return String(arg.unserializableValue);
                if (arg.value !== undefined)
                    return typeof arg.value === 'string'
                        ? arg.value
                        : JSON.stringify(arg.value);
                return String(arg.description ?? '');
            }).join(' ');
            sendConsole(level, text);
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Log.entryAdded', (event: any) => {
            const entry = event.entry as { level: string; text: string };
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
    private static _setupUrlSync(page: Page, ws: WebSocket): void {
        page.on('framenavigated', (frame) => {
            if (frame !== page.mainFrame()) return;
            const currentUrl = page.url();
            if (!/^https?:\/\//i.test(currentUrl)) return;
            if (ws.readyState !== ws.OPEN) return;
            ws.send(encodeUrlUpdate(currentUrl), { binary: true });
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
    private static _setupTabInterception(
        context:   BrowserContext,
        page:      Page,
        sessionId: string,
    ): void {
        context.on('page', (newPage) => {
            if (newPage === page) return;

            (async () => {
                let targetUrl: string | null = null;
                try {
                    await newPage.waitForURL(
                        (u: URL) => u.protocol !== 'about:' && u.protocol !== 'chrome:',
                        { timeout: 2_000 },
                    );
                    targetUrl = newPage.url();
                } catch {
                    try { targetUrl = newPage.url(); } catch { /* page gone */ }
                }

                try { await newPage.close(); } catch { /* already closed */ }

                if (!targetUrl                              ||
                    targetUrl.startsWith('about:')         ||
                    targetUrl.startsWith('chrome:')        ||
                    targetUrl.startsWith('chrome-extension://')) {
                    return;
                }

                console.log(`[${sessionId}] Extra tab intercepted → navigating main tab to ${targetUrl}`);

                try {
                    await page.goto(targetUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout:   30_000,
                    });
                } catch { /* navigation error — main tab may have already moved */ }
            })().catch(err => {
                console.warn(`[${sessionId}] Tab-interception error:`, (err as Error).message);
            });
        });
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
    private static _wrapEval(code: string): string {
        return (
            `(async function(){try{`
            + `var __r=(0,eval)(${JSON.stringify(code)});`
            + `if(__r&&typeof __r.then==='function')__r=await __r;`
            + `return{ok:true,v:__r===undefined?null:`
            + `(function(){try{return JSON.stringify(__r)}catch(_){return String(__r)}})()}`
            + `}catch(e){return{ok:false,v:e.message||String(e)}}})() `
        );
    }
}
