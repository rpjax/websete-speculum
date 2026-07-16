import { WebSocket } from 'ws';
import * as fs from 'fs';
import { BrowserContext, Page, CDPSession } from 'patchright';
import { VirtualDisplay }    from './VirtualDisplay';
import { launchBrowser }     from './BrowserLauncher';
import { ScreencastPipeline } from './ScreencastPipeline';
import { JsBridgeSetup }     from './JsBridgeSetup';
import { UrlSyncBridge, StatusPublisher } from './UrlSyncBridge';
import { NavigationGuard }   from '../navigation/NavigationGuard';
import { InputPipeline }     from '../input/InputPipeline';
import { exportBrowserState, importLocalStorageAfterNavigation, BrowserStatePayload } from '../BrowserState';
import { ScriptEntry } from '../protocol/wire-protocol';
import { normalizeDeviceProfile, type DeviceProfile } from '../protocol/device-profile';
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
    private _width:    number;
    private _height:   number;
    private _device:   DeviceProfile;
    private _onFrame:  (buf: Buffer) => void;
    private _input:    InputPipeline;
    private _status:   StatusPublisher;

    private _exportingState: boolean = false;
    private _userDataDir: string;
    private _disposed: boolean = false;
    private _browserQuiesced: boolean = false;

    private constructor(
        sessionId:       string,
        ws:              WebSocket,
        display:         VirtualDisplay,
        context:         BrowserContext,
        page:            Page,
        cdp:             CDPSession,
        capture:         ScreencastPipeline,
        width:           number,
        height:          number,
        device:          DeviceProfile,
        onFrame:         (buf: Buffer) => void,
        jsBridgeEnabled: boolean,
        userDataDir:     string,
        handleEvalJs:    (id: number, code: string) => Promise<void>,
    ) {
        this.sessionId    = sessionId;
        this._ws          = ws;
        this._display     = display;
        this._context     = context;
        this._page        = page;
        this._cdp         = cdp;
        this._capture     = capture;
        this._width       = width;
        this._height      = height;
        this._device      = device;
        this._onFrame     = onFrame;
        this._userDataDir = userDataDir;

        this._input = new InputPipeline({
            sessionId,
            page,
            cdp,
            capture,
            onFrame,
            jsBridgeEnabled,
            onEvalJs:      handleEvalJs,
            isExporting:   () => this._exportingState,
            isDisposed:    () => this._disposed,
            getDimensions: () => ({ width: this._width, height: this._height }),
            setDimensions: (w, h) => { this._width = w; this._height = h; },
            getDevice:     () => this._device,
            setDevice:     (d) => { this._device = d; },
            resizeDisplay: (w, h) => this._display.resize(w, h),
        });

        this._status = new StatusPublisher(
            ws, context, page, this._input.resizeGuard,
            () => ({ width: this._width, height: this._height }),
        );
    }

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
        const profile = normalizeDeviceProfile(device);
        console.log(`[${sessionId}] Launching Chrome on display ${display.displayEnv}`);

        let context: BrowserContext | undefined;
        let cdp: CDPSession | undefined;
        let userDataDir = '';
        try {
            const handle = await launchBrowser(
                sessionId, display.displayEnv, width, height, browserState, profile);
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

            const MAX_IN_FLIGHT = 3;
            let   inFlight      = 0;

            const onFrame = (buf: Buffer): void => {
                if (ws.readyState !== ws.OPEN) return;
                if (inFlight >= MAX_IN_FLIGHT)   return;
                inFlight++;
                ws.send(buf, { binary: true }, () => { inFlight--; });
            };

            const capture = await ScreencastPipeline.start(cdp, width, height, onFrame);

            console.log(`[${sessionId}] Session ready`);

            const handleEvalJs = jsBridgeEnabled
                ? JsBridgeSetup.createEvalHandler(cdp, ws)
                : async () => {};

            const session = new RemoteBrowserSession(
                sessionId, ws, display, context, page, cdp,
                capture, width, height, profile, onFrame, jsBridgeEnabled, userDataDir,
                handleEvalJs,
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
        if (this._disposed) {
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
