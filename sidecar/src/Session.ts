import { WebSocket } from 'ws';
import { BrowserContext, Page } from 'patchright';
import { DisplayManager } from './DisplayManager';
import { launchBrowser }  from './BrowserManager';
import { FFmpegCapture }  from './FFmpegCapture';
import { decodeMessage, encodeUrlUpdate } from './Protocol';

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

    private _disposed: boolean = false;

    private constructor(
        sessionId: string,
        ws:        WebSocket,
        display:   DisplayManager,
        context:   BrowserContext,
        page:      Page,
        capture:   FFmpegCapture,
        width:     number,
        height:    number,
        onFrame:   (buf: Buffer) => void,
    ) {
        this.sessionId = sessionId;
        this._ws       = ws;
        this._display  = display;
        this._context  = context;
        this._page     = page;
        this._capture  = capture;
        this._width    = width;
        this._height   = height;
        this._onFrame  = onFrame;
    }

    // ── Factory ───────────────────────────────────────────────────────────────

    static async create(
        sessionId: string,
        ws:        WebSocket,
        display:   DisplayManager,
        width:     number,
        height:    number,
        url?:      string,
    ): Promise<Session> {
        console.log(`[${sessionId}] Launching Chrome on display ${display.displayEnv}`);

        let context: BrowserContext | undefined;
        try {
            const handle = await launchBrowser(display.displayEnv, width, height);
            context = handle.context;
            const page = handle.page;

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

            // ── New-tab interception ──────────────────────────────────────────
            // Prevent any page in this context from opening a new tab or window.
            // This is mandatory for a MITM proxy: the user must never be able to
            // escape the session by spawning an uncontrolled window.
            //
            // Strategy:
            //   1. Immediately sever window.opener so the new page cannot
            //      manipulate the main page while we wait.
            //   2. Wait for domcontentloaded (not just the first URL change) so
            //      all HTTP-level redirects have been followed and we capture the
            //      final destination URL, not an intermediate tracking redirect.
            //   3. Close the new page, then navigate the main page.
            //
            // Why not waitForURL?
            //   waitForURL fires on the first non-about: URL, which is often a
            //   tracking/redirect intermediary. Loading that URL as the main page
            //   causes the tracking page to behave differently (no opener, wrong
            //   context) and may redirect back to the original page — the source
            //   of the "vai e vem" oscillation.
            //
            // Why null opener?
            //   Some redirect pages do window.opener.location = finalUrl before
            //   our goto() runs. This creates two concurrent navigations on the
            //   main page (one from the popup's JS, one from our goto()), which
            //   race non-deterministically and produce the oscillation.
            //
            // The handler is non-async from the EventEmitter's perspective; errors
            // are caught internally so they never become unhandled Promise rejections.
            context.on('page', (newPage) => {
                if (newPage === page) return;

                // Sever opener immediately — this addInitScript runs before any
                // script on the new page's real URL (fires on every navigation of
                // this page instance, including the first one away from about:blank).
                // Pass as a string so TypeScript does not try to type-check browser
                // globals (window) that do not exist in the Node.js lib.
                newPage.addInitScript(`
                    try {
                        Object.defineProperty(window, 'opener', {
                            value: null, writable: false, configurable: false,
                        });
                    } catch (e) { /* already non-configurable — ignore */ }
                `).catch(() => { /* page closed before script could be added */ });

                (async () => {
                    let targetUrl: string | null = null;
                    try {
                        // domcontentloaded guarantees all HTTP redirects have been
                        // followed. The URL at this point is the final destination,
                        // not an intermediate redirect hop.
                        await newPage.waitForLoadState('domcontentloaded', { timeout: 5_000 });
                        targetUrl = newPage.url();
                    } catch {
                        // Never reached a real page (timeout, crash, already closed).
                        // Just close it and bail — no navigation on the main page.
                    }

                    try { await newPage.close(); } catch { /* best-effort */ }

                    if (targetUrl &&
                        !targetUrl.startsWith('about:') &&
                        !targetUrl.startsWith('chrome:'))
                    {
                        try {
                            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                        } catch { /* navigation error — ignore */ }
                    }
                })().catch(err => {
                    console.warn(`[${sessionId}] New-tab interception error:`, (err as Error).message);
                });
            });

            // ── URL sync ──────────────────────────────────────────────────────
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

            // FFmpegCapture reads the Xvfb framebuffer via XShm (zero-copy) and
            // JPEG-encodes at ~2 ms/frame — far faster than CDP captureScreenshot.
            const capture = await FFmpegCapture.start(
                display.number, width, height, onFrame,
            );

            console.log(`[${sessionId}] Session ready`);

            return new Session(
                sessionId, ws, display, context, page,
                capture, width, height, onFrame,
            );
        } catch (err) {
            // Clean up partially-created resources on failure.
            // With launchPersistentContext, context.close() also closes the browser.
            try { await context?.close(); } catch { /* best-effort */ }
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

                        // 1. Resize the Xvfb virtual display.
                        await this._display.resize(w, h);

                        // 2. Give Chrome and matchbox time to react to the RandR
                        //    notification and re-render the fullscreen window.
                        await new Promise<void>(r => setTimeout(r, 500));

                        // 3. Stop the old capture and start a new one at the new size.
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
        try { await this._context.close(); }     catch { /* already closed  */ }
        // Note: with launchPersistentContext, context.close() also closes the
        // browser process — no separate browser.close() call needed.
        try { await this._display.dispose(); }   catch { /* already gone    */ }
    }
}
