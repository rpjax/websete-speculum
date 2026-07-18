import { CDPSession } from 'patchright';
import { encodeScreencastFrame } from '../protocol/wire-protocol';
import { readJpegDimensions } from './jpeg-geometry';

/**
 * Captures frames via CDP Page.startScreencast.
 *
 * Chrome pushes JPEG frames on visual change. For idle/static pages we also
 * push a fresh Page.captureScreenshot on a timer so clients always observe a
 * live stream. Idle JPEGs whose decoded geometry diverges from the confirmed
 * viewport are discarded (never stretched to fake sync).
 */
export class ScreencastPipeline {
    private _cdp:     CDPSession;
    private _stopped: boolean                           = false;
    private _handler: ((event: unknown) => void) | null = null;
    private _onFrame: ((buf: Buffer) => void) | null    = null;
    private _idleTimer: ReturnType<typeof setInterval> | null = null;
    private _lastFrameAt = 0;
    private _idleBusy = false;
    private _width = 0;
    private _height = 0;

    /** Push a fallback screenshot if Chromium stayed silent this long. */
    static readonly IDLE_MS = 750;

    /** Pure idle decision — unit-tested without CDP. */
    static shouldEmitIdleFrame(lastFrameAt: number, now: number, idleMs = ScreencastPipeline.IDLE_MS): boolean {
        return now - lastFrameAt >= idleMs;
    }

    private constructor(cdp: CDPSession) {
        this._cdp = cdp;
    }

    static async start(
        cdp:     CDPSession,
        width:   number,
        height:  number,
        onFrame: (buf: Buffer) => void,
    ): Promise<ScreencastPipeline> {
        const sc = new ScreencastPipeline(cdp);
        await sc._attach(width, height, onFrame);
        return sc;
    }

    /** Update confirmed viewport used for idle clip (no screencast restart). */
    setViewport(width: number, height: number): void {
        this._width = width;
        this._height = height;
    }

    async restart(
        width:   number,
        height:  number,
        onFrame: (buf: Buffer) => void,
        cdp?:    CDPSession,
    ): Promise<void> {
        if (this._stopped) return;
        this._clearIdleTimer();
        try { await this._cdp.send('Page.stopScreencast', {}); } catch { /* best-effort */ }
        if (cdp) this._cdp = cdp;
        await this._attach(width, height, onFrame);
    }

    async stop(): Promise<void> {
        if (this._stopped) return;
        this._stopped = true;
        this._clearIdleTimer();

        if (this._handler) {
            this._cdp.off('Page.screencastFrame', this._handler);
            this._handler = null;
        }
        this._onFrame = null;

        try { await this._cdp.send('Page.stopScreencast', {}); } catch { /* best-effort */ }
    }

    private async _attach(
        width:   number,
        height:  number,
        onFrame: (buf: Buffer) => void,
    ): Promise<void> {
        if (this._handler) {
            this._cdp.off('Page.screencastFrame', this._handler);
        }

        const cdp  = this._cdp;
        const self = this;
        this._onFrame = onFrame;
        this._width = width;
        this._height = height;
        this._lastFrameAt = Date.now();

        this._handler = function screencastFrameHandler(event: unknown): void {
            if (self._stopped) return;
            const ev = event as { data: string; sessionId: number };
            cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
            const jpeg = Buffer.from(ev.data, 'base64');
            if (!self._jpegMatchesViewport(jpeg)) return;
            self._lastFrameAt = Date.now();
            onFrame(encodeScreencastFrame(jpeg));
        };

        this._cdp.on('Page.screencastFrame', this._handler);

        // Ceiling caps — Chromium scales down to the page; do not restart on every resize.
        await this._cdp.send('Page.startScreencast', {
            format:        'jpeg',
            quality:       80,
            maxWidth:      4096,
            maxHeight:     2160,
            everyNthFrame: 1,
        });

        this._armIdleTimer();
    }

    private _armIdleTimer(): void {
        this._clearIdleTimer();
        this._idleTimer = setInterval(() => {
            void this._maybeIdleCapture();
        }, ScreencastPipeline.IDLE_MS);
        this._idleTimer.unref?.();
    }

    private _clearIdleTimer(): void {
        if (this._idleTimer) {
            clearInterval(this._idleTimer);
            this._idleTimer = null;
        }
    }

    private async _maybeIdleCapture(): Promise<void> {
        if (this._stopped || this._idleBusy || !this._onFrame) return;
        if (!ScreencastPipeline.shouldEmitIdleFrame(this._lastFrameAt, Date.now())) return;
        if (this._width < 1 || this._height < 1) return;

        this._idleBusy = true;
        try {
            const result = await this._cdp.send('Page.captureScreenshot', {
                format: 'jpeg',
                quality: 80,
                fromSurface: true,
                clip: {
                    x: 0,
                    y: 0,
                    width: this._width,
                    height: this._height,
                    scale: 1,
                },
            }) as { data: string };
            if (this._stopped || !this._onFrame || !result?.data) return;
            const jpeg = Buffer.from(result.data, 'base64');
            if (!this._jpegMatchesViewport(jpeg)) return;
            this._lastFrameAt = Date.now();
            this._onFrame(encodeScreencastFrame(jpeg));
        } catch {
            // CDP may be mid-navigation / mid-rebind; skip this tick.
        } finally {
            this._idleBusy = false;
        }
    }

    private _jpegMatchesViewport(jpeg: Buffer): boolean {
        const dims = readJpegDimensions(jpeg);
        if (!dims) return false;
        return dims.width === this._width && dims.height === this._height;
    }
}
