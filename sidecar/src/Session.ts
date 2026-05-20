import { WebSocket } from 'ws';
import { BrowserContext, Page, CDPSession } from 'patchright';
import { DisplayManager } from './DisplayManager';
import { launchBrowser }  from './BrowserManager';
import { FFmpegCapture }  from './FFmpegCapture';
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

/** Maps Log.entryAdded severity strings to wire-level level bytes (same as CONSOLE_LEVELS). */
const LOG_LEVEL: Record<string, number> = { verbose: 0, info: 3, warning: 1, error: 2 };

/** Maps DOM MouseEvent.button (0=left,1=middle,2=right) → Playwright button name. */
function domButton(b: number): 'left' | 'middle' | 'right' {
    if (b === 1) return 'middle';
    if (b === 2) return 'right';
    return 'left';
}

/**
 * Represents one complete browser session:
 *   Xvfb display → Chrome (non-headless) → FFmpeg x11grab → binary WS frames
 *   binary WS input → CDP mouse/keyboard → Chrome
 *
 * Lifecycle:
 *   Session.create() → send frames → handleMessage() for input
 *   dispose() → stops capture → closes browser → kills Xvfb
 */
export class Session {
    readonly sessionId: string;

    private _ws:       WebSocket;
    private _display:  DisplayManager;
    private _context:  BrowserContext;
    private _page:     Page;
    private _cdp:      CDPSession;
    private _capture:  FFmpegCapture;
    private _width:    number;
    private _height:   number;

    /**
     * The frame callback shared across all FFmpegCapture instances for this
     * session. Stored so we can hand it to a new capture after a resize
     * without re-wiring the WebSocket send logic.
     */
    private _onFrame:  (buf: Buffer) => void;

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
        capture:         FFmpegCapture,
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

            // ── Single-tab enforcement — Layer 1 (prevention) ────────────────
            // Installed on the context so it applies to ALL pages, including any
            // page created in the brief window before context.on('page') can
            // close it.  Must run before page.goto() so the initial navigation
            // is also covered.
            //
            // What it does:
            //   • Nulls window.opener — prevents a stray popup from doing
            //     window.opener.location = '...' on the main tab, which was the
            //     root cause of the "vai e vem" (oscillation) bug.
            //   • Overrides window.open() to redirect in the current tab instead
            //     of spawning a new one.
            //   • Intercepts target="_blank" anchor clicks in the capture phase
            //     (before any site handler) and converts them to same-tab
            //     navigations.
            //   • Redirects target="_blank" form submissions to _self.
            //
            // This prevents ~95 % of new-tab attempts at the JavaScript layer.
            // context.on('page') below is the catch-all for the remaining cases
            // (e.g. browser-internal popup mechanisms that bypass JS).
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

            // ── Script injection via CDP Page.addScriptToEvaluateOnNewDocument ──
            //
            // Why this instead of context.route / route.fetch?
            //
            //   route.fetch() makes a real HTTP request from Node.js — it uses
            //   Node.js's TLS stack, which has a completely different JA3/JA4
            //   fingerprint than Chrome's BoringSSL. Cloudflare and similar
            //   systems compare the TLS fingerprint of the TCP handshake against
            //   the declared User-Agent; a Node.js JA3 with a Chrome UA is an
            //   instant 403. Even having context.route() active (without fetch)
            //   enables CDP Fetch domain interception, which some fingerprinters
            //   detect via timing or internal Chrome property differences.
            //
            // Why this instead of context.addInitScript?
            //
            //   Playwright/Patchright executes addInitScript in the isolated
            //   utility world (__playwright_utility_world__), a separate V8
            //   context. Globals set there — window.myLib, prototype patches,
            //   window.open overrides — are invisible to page scripts in the
            //   main world. The injection would silently do nothing.
            //
            // Page.addScriptToEvaluateOnNewDocument (raw CDP, no worldName):
            //   • Chrome runs it in the MAIN world, before any page script.
            //   • Persists across every navigation for the lifetime of the CDP
            //     session — no re-injection needed after page.goto().
            //   • Never touches the network stack; zero impact on TLS/HTTP
            //     fingerprints; Cloudflare cannot detect it.
            //   • Not subject to CSP — Chrome's engine evaluates it directly,
            //     bypassing the page's content-security-policy entirely.
            //
            // Position timing:
            //   HeaderTop / HeaderBottom → script runs at document start (before
            //     the page's own <script> tags execute).
            //   BodyTop  → wrapped in DOMContentLoaded (DOM ready, scripts done).
            //   BodyBottom → wrapped in window 'load' (all resources loaded).
            if (scripts.length > 0) {
                const sorted = [...scripts].sort(
                    (a, b) =>
                        (POSITION_ORDER[a.position] ?? 99) -
                        (POSITION_ORDER[b.position] ?? 99),
                );

                // Disable CSP at the Chrome level so any secondary resource the
                // injected scripts might load (dynamic import, fetch) is not blocked.
                // This has no network footprint — it is a pure CDP command.
                try { await cdp.send('Page.setBypassCSP', { enabled: true }); } catch { /* best-effort */ }

                for (const s of sorted) {
                    let source: string;

                    if (s.position === 'HeaderTop' || s.position === 'HeaderBottom') {
                        // No wrapper — runs synchronously at document start.
                        source = s.content;
                    } else if (s.position === 'BodyTop') {
                        // Defer until DOM is ready.
                        source =
                            '(function(){\n' +
                            '  document.addEventListener("DOMContentLoaded",function(){\n' +
                            s.content + '\n' +
                            '  });\n' +
                            '})();';
                    } else {
                        // BodyBottom — defer until all resources have loaded.
                        source =
                            '(function(){\n' +
                            '  window.addEventListener("load",function(){\n' +
                            s.content + '\n' +
                            '  });\n' +
                            '})();';
                    }

                    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
                    console.log(`[${sessionId}] Registered injection: ${s.position} ${s.file}`);
                }
            }

            // ── JsBridge — console forwarding ─────────────────────────────────
            // Subscribed on our own CDPSession (not page.on('console')) for a
            // critical reason:
            //
            //   page.on('console') listens on Playwright's *internal* CDP session.
            //   When evaljs runs code via Runtime.evaluate on OUR session, Chrome
            //   routes Runtime.consoleAPICalled back to OUR session only — not to
            //   Playwright's. So page.on('console') silently drops every console.*
            //   call produced by vcon().
            //
            // By enabling Runtime and Log on our session we capture:
            //   • Runtime.consoleAPICalled — all JS console.* calls, including
            //     those triggered by our own Runtime.evaluate (evaljs).
            //   • Log.entryAdded — browser-level messages: network errors (401,
            //     ERR_NAME_NOT_RESOLVED), CSP violations, mixed-content warnings.
            //
            // Text is capped at 64 KB per message to prevent a runaway logger
            // from flooding the WebSocket.
            if (jsBridgeEnabled) {
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
                        if (arg.type === 'undefined')               return 'undefined';
                        if (arg.unserializableValue !== undefined)  return String(arg.unserializableValue);
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

            // ── URL sync ──────────────────────────────────────────────────────
            // Registered before page.goto() so the very first navigation is
            // captured and the client URL bar reflects the initial page.
            // Whenever the main frame navigates (user click, page.goto, goBack,
            // goForward, or new-tab redirect), send the current URL to the client
            // so the URL bar stays in sync without the client having to poll.
            page.on('framenavigated', (frame) => {
                if (frame !== page.mainFrame()) return;
                const currentUrl = page.url();
                if (currentUrl.startsWith('about:') || currentUrl.startsWith('chrome:')) return;
                if (ws.readyState !== ws.OPEN) return;
                ws.send(encodeUrlUpdate(currentUrl), { binary: true });
            });

            // ── Single-tab enforcement — Layer 2 (catch-all) ─────────────────
            // Registered BEFORE page.goto() so popups opened by page scripts
            // during the initial load are caught — not just popups triggered
            // by later user interaction.
            //
            // Catches any page that Layer 1 did not prevent (e.g. browser-level
            // popup mechanisms that bypass JavaScript).
            //
            // Policy: close the extra tab within milliseconds, then navigate the
            // main tab to the target URL so the user reaches the intended page.
            //
            // Why waitForURL instead of waitForLoadState('domcontentloaded')?
            //   domcontentloaded keeps the extra tab alive for up to 5 seconds
            //   while HTML is fetched and parsed. waitForURL(protocol != 'about:')
            //   resolves the moment Chrome issues the network request for the target
            //   URL — typically 50–200 ms after the tab is created. The extra tab
            //   exists for the absolute minimum possible time.
            //
            // Why is the "vai e vem" (oscillation) bug gone?
            //   Layer 1 nulls window.opener on EVERY page via context.addInitScript,
            //   so no stray popup can do window.opener.location = '...'. There is
            //   no concurrent navigation racing with our page.goto().
            //
            // Chrome-extension:// and chrome:// pages are left alone — they are
            // internal browser infrastructure, not user-initiated tabs.
            context.on('page', (newPage) => {
                if (newPage === page) return;

                (async () => {
                    // Wait only until the URL leaves about:blank — the extra tab is
                    // alive for the shortest possible time.
                    let targetUrl: string | null = null;
                    try {
                        await newPage.waitForURL(
                            (u: URL) => u.protocol !== 'about:' && u.protocol !== 'chrome:',
                            { timeout: 2_000 },
                        );
                        targetUrl = newPage.url();
                    } catch {
                        // Timed out or page already closed — capture whatever we have.
                        try { targetUrl = newPage.url(); } catch { /* page gone */ }
                    }

                    // ── Close immediately — enforce single-tab invariant ──────
                    try { await newPage.close(); } catch { /* already closed */ }

                    // Ignore Chrome-internal and extension pages.
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

            // Navigate to initial URL if provided.
            if (url) {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            }

            // ── Frame relay with in-flight dropping ───────────────────────────
            // Allow at most MAX_IN_FLIGHT frames queued in the WS send buffer at
            // once. If the .NET relay or the network is slow, inFlight hits the
            // cap and new frames are dropped rather than accumulating in memory.
            const MAX_IN_FLIGHT = 3;
            let   inFlight      = 0;

            // Build the frame callback once so resize can reuse it.
            const onFrame = (buf: Buffer): void => {
                if (ws.readyState !== ws.OPEN) return;
                if (inFlight >= MAX_IN_FLIGHT)   return; // network backed up — drop
                inFlight++;
                ws.send(buf, { binary: true }, () => { inFlight--; });
            };

            // FFmpegCapture reads the Xvfb framebuffer via XShm (zero-copy) and
            // JPEG-encodes at ~2 ms/frame — far faster than CDP captureScreenshot.
            const capture = await FFmpegCapture.start(
                display.number, width, height, onFrame,
            );

            console.log(`[${sessionId}] Session ready`);

            return new Session(
                sessionId, ws, display, context, page, cdp,
                capture, width, height, onFrame, jsBridgeEnabled,
            );
        } catch (err) {
            // Clean up partially-created resources on failure.
            // With launchPersistentContext, context.close() also closes the browser.
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

                // ── Pointer — page.mouse uses CDP page-coords, no screen offset ──

                case 'mousemove':
                    await this._page.mouse.move(msg.x, msg.y);
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

                // ── Keyboard — page.keyboard uses CDP; works even without X11 focus ──
                // (once mouse moved to CDP, Chrome's X11 window loses X11 focus, so
                // xdotool keystrokes are silently dropped. CDP keyboard bypasses that.)

                case 'keydown':
                    // keyboard.down/up only accepts ASCII printable chars and
                    // named DOM keys (e.g. "Enter", "Shift"). Non-ASCII chars
                    // (ç, é, ã, ñ, CJK, etc.) must go through keyboard.type()
                    // which accepts any Unicode codepoint.
                    if (msg.key.length === 1 && msg.key.charCodeAt(0) > 127) {
                        await this._page.keyboard.type(msg.key);
                    } else {
                        await this._page.keyboard.down(msg.key);
                    }
                    break;

                case 'keyup':
                    // Skip keyup for non-ASCII chars — the matching keydown
                    // already handled the full press cycle via keyboard.type().
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

                // ── JsBridge — evaluate JS in the virtual browser ────────────
                // Runs arbitrary code in the page's main execution context and
                // returns the result serialised as JSON. Console output produced
                // during the evaluation is captured independently by the
                // cdp.on('Runtime.consoleAPICalled') handler above and forwarded
                // as MSG_CONSOLE frames — the two channels are fully decoupled.
                //
                // ⚠ We send Runtime.evaluate directly on our CDPSession instead
                //   of page.evaluate(). page.evaluate() uses Playwright's internal
                //   isolated utility world — console.* calls from that world are
                //   routed back only to Playwright's own internal session, not to
                //   ours, so they would be silently dropped from the JsBridge.
                //   Omitting contextId in Runtime.evaluate defaults to the page's
                //   main execution context, whose Runtime.consoleAPICalled events
                //   ARE delivered to our CDPSession (which has Runtime.enable active).
                case 'evaljs': {
                    if (!this._jsBridgeEnabled) break;

                    const { id, code } = msg;
                    let ok    = true;
                    let value = '';

                    try {
                        // The wrapper async IIFE:
                        //   • Indirect eval runs the code at global scope (access
                        //     to window, document, etc.).
                        //   • If the result is a thenable (Promise), it is awaited
                        //     before serialisation — so `await vcon("await fetch(…)")`
                        //     returns the resolved value, not a plain Promise object.
                        //   • Returns { ok, v } so errors are reported through the
                        //     result value rather than CDP exceptionDetails, which
                        //     avoids the need to parse the exception description.
                        //   • v is null for undefined results (undefined is not
                        //     JSON-serialisable across the CDP boundary).
                        //   • awaitPromise:true tells CDP to await the outer Promise
                        //     returned by the async IIFE before resolving the call.
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const res: any = await this._cdp.send('Runtime.evaluate', {
                            expression: `(async function(){try{`
                                + `var __r=(0,eval)(${JSON.stringify(code)});`
                                + `if(__r&&typeof __r.then==='function')__r=await __r;`
                                + `return{ok:true,v:__r===undefined?null:`
                                + `(function(){try{return JSON.stringify(__r)}catch(_){return String(__r)}})()}`
                                + `}catch(e){return{ok:false,v:e.message||String(e)}}})()`,
                            returnByValue: true,
                            awaitPromise:  true,
                            timeout:       10_000,
                        });

                        if (res.exceptionDetails) {
                            // The wrapper itself threw — should not happen.
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

                    const buf = encodeEvalResult(id, ok, value);
                    if (this._ws.readyState === this._ws.OPEN) {
                        this._ws.send(buf, { binary: true });
                    }
                    break;
                }

                // ── Live resize ───────────────────────────────────────────────
                // The client sends { type:'resize', width, height } whenever its
                // viewport element changes size (debounced 250 ms).
                //
                // Sequence:
                //   1. xrandr switches the Xvfb virtual display to the new size.
                //      matchbox-window-manager forwards the RandR event to Chrome,
                //      which resizes its fullscreen window to fill the new display.
                //   2. Wait 500 ms for Chrome to settle (re-render at new size).
                //   3. Restart FFmpegCapture at the new size. FFmpeg's x11grab
                //      always captures from (0,0) with the given -video_size, so
                //      it naturally frames the new resolution.
                //
                // A _resizing guard prevents overlapping resize operations.
                case 'resize': {
                    if (this._resizing) break;
                    this._resizing = true;
                    try {
                        const w = msg.width;
                        const h = msg.height;

                        // Ignore no-ops and absurdly small sizes.
                        if (w === this._width && h === this._height) break;
                        if (w < 100 || h < 100) break;

                        console.log(`[${this.sessionId}] Resize → ${w}×${h}`);

                        // 1. Update Chrome's render viewport via CDP — authoritative,
                        //    bypasses any WM / RANDR ambiguity about window size.
                        try {
                            await this._cdp.send('Emulation.setDeviceMetricsOverride', {
                                width: w, height: h,
                                deviceScaleFactor: 1,
                                mobile: false,
                            });
                        } catch { /* CDP session may have been recycled — best-effort */ }

                        // 2. Resize the Xvfb virtual display so FFmpeg x11grab
                        //    captures the correct region at the new dimensions.
                        await this._display.resize(w, h);

                        // 3. Give Chrome time to re-render at the new size.
                        await new Promise<void>(r => setTimeout(r, 500));

                        // 4. Stop the old capture and start a new one at the new size.
                        try { await this._capture.stop(); } catch { /* already stopped */ }
                        this._width   = w;
                        this._height  = h;
                        this._capture = await FFmpegCapture.start(
                            this._display.number, w, h, this._onFrame,
                        );

                        console.log(`[${this.sessionId}] Capture restarted at ${w}×${h}`);
                    } finally {
                        this._resizing = false;
                    }
                    break;
                }
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

        try { await this._capture.stop(); }      catch { /* already stopped */ }
        try { await this._cdp.detach(); }        catch { /* already detached */ }
        try { await this._context.close(); }     catch { /* already closed  */ }
        // Note: with launchPersistentContext, context.close() also closes the
        // browser process — no separate browser.close() call needed.
        try { await this._display.dispose(); }   catch { /* already gone    */ }
    }
}
