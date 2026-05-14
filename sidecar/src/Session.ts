import { WebSocket } from 'ws';
import { Browser, BrowserContext, Page } from 'patchright';
import { DisplayManager } from './DisplayManager';
import { launchBrowser }  from './BrowserManager';
import { FFmpegCapture }  from './FFmpegCapture';
import { decodeMessage } from './Protocol';

/** Maps DOM MouseEvent.button (0=left,1=middle,2=right) → Playwright button name. */
function domButton(b: number): 'left' | 'middle' | 'right' {
    if (b === 1) return 'middle';
    if (b === 2) return 'right';
    return 'left';
}

/**
 * Represents one complete browser session:
 *   Xvfb display → Chrome (non-headless) → CDP screencast → binary WS frames
 *   binary WS input → xdotool → X11 events → Chrome
 *
 * Lifecycle:
 *   Session.create() → send frames → handleMessage() for input
 *   dispose() → stops screencast → closes browser → kills Xvfb
 */
export class Session {
    readonly sessionId: string;

    private _ws:       WebSocket;
    private _display:  DisplayManager;
    private _browser:  Browser;
    private _context:  BrowserContext;
    private _page:     Page;
    private _capture:  FFmpegCapture;
    private _disposed: boolean = false;

    private constructor(
        sessionId: string,
        ws:        WebSocket,
        display:   DisplayManager,
        browser:   Browser,
        context:   BrowserContext,
        page:      Page,
        capture:   FFmpegCapture,
    ) {
        this.sessionId = sessionId;
        this._ws       = ws;
        this._display  = display;
        this._browser  = browser;
        this._context  = context;
        this._page     = page;
        this._capture  = capture;
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

        let browser: Browser | undefined;
        let context: BrowserContext | undefined;
        try {
            const handle = await launchBrowser(display.displayEnv, width, height);
            browser = handle.browser;
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
            // The .NET side has its own DropOldest channel as a second layer.
            const MAX_IN_FLIGHT = 3;
            let   inFlight      = 0;

            // FFmpegCapture reads the Xvfb framebuffer via XShm (zero-copy) and
            // JPEG-encodes at ~2 ms/frame — far faster than CDP captureScreenshot.
            const capture = await FFmpegCapture.start(
                display.number, width, height,
                (buf) => {
                    if (ws.readyState !== ws.OPEN) return;
                    if (inFlight >= MAX_IN_FLIGHT) return; // network backed up — drop

                    inFlight++;
                    ws.send(buf, { binary: true }, () => { inFlight--; });
                },
            );

            console.log(`[${sessionId}] Session ready`);

            return new Session(sessionId, ws, display, browser, context, page, capture);
        } catch (err) {
            // Clean up partially-created resources on failure.
            try { await context?.close(); }  catch { /* best-effort */ }
            try { await browser?.close(); }  catch { /* best-effort */ }
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
                    await this._page.keyboard.down(msg.key);
                    break;

                case 'keyup':
                    await this._page.keyboard.up(msg.key);
                    break;

                case 'type':
                    await this._page.keyboard.type(msg.text);
                    break;

                case 'resize':
                    // Not supported: FFmpeg captures the Xvfb framebuffer at a fixed
                    // resolution set at session creation. Changing the CDP viewport
                    // independently would cause a mismatch (grey bars or clipped content).
                    // Resize requires tearing down and recreating the entire session.
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

        try { await this._capture.stop(); }      catch { /* already stopped */ }
        try { await this._context.close(); }     catch { /* already closed  */ }
        try { await this._browser.close(); }     catch { /* already closed  */ }
        try { await this._display.dispose(); }   catch { /* already gone    */ }
    }
}
