import { WebSocket } from 'ws';
import * as fs from 'fs';
import { BrowserContext, Page, CDPSession } from 'patchright';
import { VirtualDisplay }    from './VirtualDisplay';
import { launchBrowser }     from './BrowserLauncher';
import { ScreencastPipeline } from './ScreencastPipeline';
import { JsBridgeSetup }     from './JsBridgeSetup';
import { UrlSyncBridge, StatusPublisher } from './UrlSyncBridge';
import { SessionViewport }   from './SessionViewport';
import { normalizeStartViewport } from './viewport-bounds';
import { NavigationGuard }   from '../navigation/NavigationGuard';
import { InputPipeline }     from '../input/InputPipeline';
import { exportBrowserState, importLocalStorageAfterNavigation, BrowserStatePayload } from '../BrowserState';
import { ScriptEntry } from '../protocol/wire-protocol';
import { normalizeDeviceProfile, type DeviceProfile } from '../protocol/device-profile';
import { readChromeViewport } from '../input/device-emulation';
import {
    capProbeData,
    collectDiagProbeEvidence,
    type DiagProbeEvidence,
    type DiagProbeOptions,
} from './DiagProbe';

/**
 * Represents one complete browser session:
 *   Xvfb display → Chrome (non-headless) → CDP Page.startScreencast → JPEG WS frames
 *   binary WS input → CDP mouse/keyboard → Chrome
 *
 * Lifecycle:
 *   RemoteBrowserSession.create() → send frames → handleMessage() for input
 *   dispose() → stops screencast → closes browser → kills Xvfb
 */
export class RemoteBrowserSession {
    readonly sessionId: string;

    private _ws:       WebSocket;
    private _display:  VirtualDisplay;
    private _context:  BrowserContext;
    private _page:     Page;
    private _cdp:      CDPSession;
    private _capture:  ScreencastPipeline;
    private _viewport: SessionViewport;
    private _onFrame:  (buf: Buffer) => void;
    private _input:    InputPipeline;
    private _status:   StatusPublisher;

    private _exportingState: boolean = false;
    private _userDataDir: string;
    private _disposed: boolean = false;
    private _faulted: boolean = false;
    /** True for the whole resize story including post-failure compensation. */
    private _resizeBusy: boolean = false;
    private _browserQuiesced: boolean = false;
    private _jsBridgeEnabled: boolean;
    private _scripts: ScriptEntry[];
    private _allowedNavigationDomains?: string[];
    private _handleEvalJs: (id: number, code: string) => Promise<void>;

    private constructor(
        sessionId:       string,
        ws:              WebSocket,
        display:         VirtualDisplay,
        context:         BrowserContext,
        page:            Page,
        cdp:             CDPSession,
        capture:         ScreencastPipeline,
        viewport:        SessionViewport,
        onFrame:         (buf: Buffer) => void,
        jsBridgeEnabled: boolean,
        userDataDir:     string,
        scripts:         ScriptEntry[],
        allowedNavigationDomains: string[] | undefined,
        handleEvalJs:    (id: number, code: string) => Promise<void>,
    ) {
        this.sessionId    = sessionId;
        this._ws          = ws;
        this._display     = display;
        this._context     = context;
        this._page        = page;
        this._cdp         = cdp;
        this._capture     = capture;
        this._viewport    = viewport;
        this._onFrame     = onFrame;
        this._userDataDir = userDataDir;
        this._jsBridgeEnabled = jsBridgeEnabled;
        this._scripts = scripts;
        this._allowedNavigationDomains = allowedNavigationDomains;
        this._handleEvalJs = handleEvalJs;

        this._input = new InputPipeline({
            sessionId,
            page,
            cdp,
            jsBridgeEnabled,
            onEvalJs:      handleEvalJs,
            isExporting:   () => this._exportingState,
            isDisposed:    () => this._disposed || this._faulted,
            getViewport:   () => this._viewport,
            onResize:      (req) => this._applyResize(req),
            sendResizeResult: (result) => {
                if (this._ws.readyState !== this._ws.OPEN) return;
                this._ws.send(JSON.stringify({ type: 'resizeResult', ...result }));
            },
        });

        this._status = new StatusPublisher(
            ws, context, page,
            () => this._resizeBusy || this._viewport.isResizing,
            () => ({ width: this._viewport.width, height: this._viewport.height }),
        );
    }

    /** Confirmed geometry after create / resize. */
    get confirmedWidth(): number { return this._viewport.width; }
    get confirmedHeight(): number { return this._viewport.height; }

    static async create(
        sessionId:       string,
        ws:              WebSocket,
        display:         VirtualDisplay,
        width:           number,
        height:          number,
        url?:            string,
        scripts:         ScriptEntry[] = [],
        jsBridgeEnabled: boolean       = false,
        allowedNavigationDomains?: string[],
        browserState?: BrowserStatePayload,
        device?: DeviceProfile,
    ): Promise<RemoteBrowserSession> {
        const start = normalizeStartViewport(width, height);
        const profile = normalizeDeviceProfile(device);
        console.log(`[${sessionId}] Launching Chrome on display ${display.displayEnv} at ${start.width}×${start.height}`);

        let context: BrowserContext | undefined;
        let cdp: CDPSession | undefined;
        let userDataDir = '';
        try {
            const handle = await launchBrowser(
                sessionId, display.displayEnv, start.width, start.height, browserState, profile);
            context     = handle.context;
            cdp         = handle.cdp;
            userDataDir = handle.userDataDir;
            const page  = handle.page;

            // Always bypass page CSP: NavigationGuard.setupSingleTabEnforcement registers an
            // addInitScript (inline). Sites with nonce-only script-src (e.g. Eneba) would otherwise
            // block it and flood the console with CSP violations the origin never shows.
            // Custom script-tag injection also requires this. Motor pages are already isolated.
            try { await cdp.send('Page.setBypassCSP', { enabled: true }); } catch { /* best-effort */ }

            await NavigationGuard.setupSingleTabEnforcement(context);
            if (jsBridgeEnabled) await JsBridgeSetup.setup(cdp, ws, sessionId);
            UrlSyncBridge.setupUrlSync(page, ws);
            NavigationGuard.setupTabInterception(context, page, sessionId);

            if (scripts.length > 0 || (allowedNavigationDomains && allowedNavigationDomains.length > 0)) {
                await NavigationGuard.setupFetchInterception(
                    cdp, ws, sessionId, scripts, allowedNavigationDomains,
                );
            }

            if (url) {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            }

            if (browserState) {
                await importLocalStorageAfterNavigation(page, browserState);
            }

            const viewport = new SessionViewport(start.width, start.height, profile);
            await viewport.confirmInitial(display, page, start.width, start.height, profile);

            const MAX_IN_FLIGHT = 3;
            let   inFlight      = 0;

            const onFrame = (buf: Buffer): void => {
                if (ws.readyState !== ws.OPEN) return;
                if (inFlight >= MAX_IN_FLIGHT)   return;
                inFlight++;
                ws.send(buf, { binary: true }, () => { inFlight--; });
            };

            const capture = await ScreencastPipeline.start(cdp, start.width, start.height, onFrame);

            console.log(`[${sessionId}] Session ready at ${start.width}×${start.height}`);

            const handleEvalJs = jsBridgeEnabled
                ? JsBridgeSetup.createEvalHandler(cdp, ws)
                : async () => {};

            const session = new RemoteBrowserSession(
                sessionId, ws, display, context, page, cdp,
                capture, viewport, onFrame, jsBridgeEnabled, userDataDir,
                scripts, allowedNavigationDomains, handleEvalJs,
            );
            session._status.start();
            return session;
        } catch (err) {
            try { await cdp?.detach(); }     catch { /* best-effort */ }
            try { await context?.close(); }  catch { /* best-effort */ }
            throw err;
        }
    }

    async handleMessage(raw: string): Promise<void> {
        return this._input.handleMessage(raw);
    }

    enqueueInput(raw: string): void {
        this._input.enqueue(raw);
    }

    async captureState(): Promise<BrowserStatePayload> {
        this._exportingState = true;
        try {
            console.log(`[${this.sessionId}] Exporting browser state via CDP`);
            return await exportBrowserState(this._cdp, this._page);
        } finally {
            this._exportingState = false;
        }
    }

    async runDiagProbe(ops: string[], options: DiagProbeOptions = {}): Promise<DiagProbeEvidence> {
        if (this._disposed || this._faulted) {
            throw new Error('session disposed');
        }

        const data = await collectDiagProbeEvidence(
            ops,
            {
                display:         this._display,
                context:         this._context,
                page:            this._page,
                cdp:             this._cdp,
                userDataDir:     this._userDataDir,
                exportingState:  this._exportingState,
            },
            options,
        );

        return capProbeData(data, options.maxProbeResponseBytes && options.maxProbeResponseBytes > 0
            ? options.maxProbeResponseBytes
            : 512 * 1024);
    }

    private async _applyResize(req: {
        requestId: string;
        width: number;
        height: number;
        device: DeviceProfile;
    }): Promise<{
        ok: boolean;
        width: number;
        height: number;
        chromeWidth?: number;
        chromeHeight?: number;
        displayWidth?: number;
        displayHeight?: number;
        errorCode?: string;
        phase?: string;
        message?: string;
    }> {
        if (this._disposed || this._faulted) {
            return {
                ok: false,
                width: this._viewport.width,
                height: this._viewport.height,
                errorCode: 'session_gone',
                phase: 'validate',
                message: 'session disposed',
            };
        }

        const previous = this._viewport.snapshot();
        let sizeChanged = false;

        this._resizeBusy = true;
        try {
            const outcome = await this._viewport.applyResize({
                requestId: req.requestId,
                width: req.width,
                height: req.height,
                device: req.device,
                display: this._display,
                page: this._page,
                cdp: this._cdp,
                sameSizeOnly: async (device) => {
                    await this._viewport.applyDeviceOnly(this._cdp, device);
                },
                recreateAtSize: async (w, h, device) => {
                    sizeChanged = true;
                    return this._recreateAtSize(w, h, device);
                },
            });

            if (outcome.ok) {
                this._capture.setViewport(outcome.width, outcome.height);
                return outcome;
            }

            // Validation / busy: confirmed physical state unchanged.
            if (outcome.errorCode === 'invalid_viewport' || outcome.errorCode === 'resize_busy') {
                return outcome;
            }

            // Partial apply failure after size change — one compensation to previous size.
            if (sizeChanged) {
                try {
                    await this._recreateAtSize(previous.width, previous.height, previous.device);
                    this._capture.setViewport(previous.width, previous.height);
                    const chrome = await readChromeViewport(this._page);
                    if (chrome.width !== previous.width || chrome.height !== previous.height) {
                        throw new Error(
                            `compensation chrome ${chrome.width}×${chrome.height} `
                            + `!= ${previous.width}×${previous.height}`,
                        );
                    }
                    const active = await this._display.readActiveGeometry();
                    if (active.width !== previous.width || active.height !== previous.height) {
                        throw new Error(
                            `compensation display ${active.width}×${active.height} `
                            + `!= ${previous.width}×${previous.height}`,
                        );
                    }
                } catch (compErr) {
                    const message = (compErr as Error).message ?? 'compensation failed';
                    console.error(`[${this.sessionId}] Resize compensation failed:`, message);
                    this._faulted = true;
                    // Session no longer has a coherent display — tear down after the result is sent.
                    void Promise.resolve().then(() => {
                        if (this._ws.readyState === this._ws.OPEN) {
                            try {
                                this._ws.send(JSON.stringify({
                                    type: 'error',
                                    sessionId: this.sessionId,
                                    message: `resize compensation failed: ${message}`.slice(0, 512),
                                    errorCode: 'resize_session_faulted',
                                }));
                            } catch { /* best-effort */ }
                            try { this._ws.close(); } catch { /* best-effort */ }
                        }
                        void this.dispose();
                    });
                    return {
                        ok: false,
                        width: previous.width,
                        height: previous.height,
                        errorCode: 'resize_session_faulted',
                        phase: 'compensate',
                        message: message.slice(0, 512),
                    };
                }
            }

            return outcome;
        } finally {
            this._resizeBusy = false;
        }
    }

    private async _recreateAtSize(
        width: number,
        height: number,
        device: DeviceProfile,
    ): Promise<{ display: VirtualDisplay; page: Page; cdp: CDPSession }> {
        const resumeUrl = this._page.url();

        try { await this._capture.stop(); } catch { /* best-effort */ }

        try { await this._cdp.detach(); } catch { /* best-effort */ }
        try { await this._context.close(); } catch { /* best-effort */ }

        this._display = await this._display.recreate(width, height);

        const handle = await launchBrowser(
            this.sessionId,
            this._display.displayEnv,
            width,
            height,
            undefined,
            device,
            { preserveUserDataDir: true },
        );
        this._context = handle.context;
        this._page = handle.page;
        this._cdp = handle.cdp;
        this._userDataDir = handle.userDataDir;

        try { await this._cdp.send('Page.setBypassCSP', { enabled: true }); } catch { /* best-effort */ }

        await NavigationGuard.setupSingleTabEnforcement(this._context);
        if (this._jsBridgeEnabled) {
            await JsBridgeSetup.setup(this._cdp, this._ws, this.sessionId);
            this._handleEvalJs = JsBridgeSetup.createEvalHandler(this._cdp, this._ws);
        }
        UrlSyncBridge.setupUrlSync(this._page, this._ws);
        NavigationGuard.setupTabInterception(this._context, this._page, this.sessionId);

        if (this._scripts.length > 0
            || (this._allowedNavigationDomains && this._allowedNavigationDomains.length > 0)) {
            await NavigationGuard.setupFetchInterception(
                this._cdp, this._ws, this.sessionId, this._scripts, this._allowedNavigationDomains,
            );
        }

        if (resumeUrl && /^https?:\/\//i.test(resumeUrl)) {
            await this._page.goto(resumeUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }

        // Fresh screencast pipeline on the new CDP session.
        this._capture = await ScreencastPipeline.start(this._cdp, width, height, this._onFrame);
        this._status.rebind(this._context, this._page);
        this._input.rebind(this._page, this._cdp);

        return { display: this._display, page: this._page, cdp: this._cdp };
    }

    async dispose(): Promise<void> {
        if (this._disposed) return;
        this._disposed = true;

        this._status.stop();

        console.log(`[${this.sessionId}] Disposing session`);

        try { await this._capture.stop(); } catch { /* already stopped */ }

        await Promise.allSettled([
            (async () => {
                if (!this._browserQuiesced) {
                    try { await this._cdp.detach(); }    catch { /* already detached */ }
                    try { await this._context.close(); } catch { /* already closed   */ }
                }
            })(),
            this._display.dispose().catch(() => { /* best-effort */ }),
        ]);

        try {
            fs.rmSync(this._userDataDir, { recursive: true, force: true });
        } catch { /* best-effort */ }
    }
}
