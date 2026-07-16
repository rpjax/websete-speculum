import { CDPSession } from 'patchright';
import { encodeScreencastFrame } from '../protocol/wire-protocol';
import { VirtualDisplay } from './VirtualDisplay';

/**
 * Captures frames from the virtual browser via CDP Page.startScreencast.
 *
 * Chrome pushes JPEG frames on visual change. For idle/static pages that only
 * emit a single frame, we also push an idle screenshot on a timer so clients
 * and assertive probes always observe a live stream (not a one-shot still).
 *
 * Each screencast frame is ACKed immediately (fire-and-forget) so Chrome can
 * enqueue the next frame without waiting for a full round-trip.
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

    async restart(
        width:   number,
        height:  number,
        onFrame: (buf: Buffer) => void,
    ): Promise<void> {
        if (this._stopped) return;
        this._clearIdleTimer();
        try { await this._cdp.send('Page.stopScreencast', {}); } catch { /* best-effort */ }
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

            // ACK immediately — Chromium waits for ack before sending another frame.
            cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});

            self._lastFrameAt = Date.now();
            onFrame(encodeScreencastFrame(Buffer.from(ev.data, 'base64')));
        };

        this._cdp.on('Page.screencastFrame', this._handler);

        await this._cdp.send('Page.startScreencast', {
            format:        'jpeg',
            quality:       80,
            maxWidth:      width,
            maxHeight:     height,
            everyNthFrame: 1,
        });

        this._armIdleTimer();
    }

    private _armIdleTimer(): void {
        this._clearIdleTimer();
        this._idleTimer = setInterval(() => {
            void this._maybeIdleCapture();
        }, ScreencastPipeline.IDLE_MS);
        // Unref so the timer never keeps the Node process alive alone.
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

        this._idleBusy = true;
        try {
            // Clip to the snapped Xvfb CRTC. Without this, a failed xrandr leave the
            // surface at 4096×2160 and idle JPEGs stretch differently than screencast
            // frames — rhythmic size/position flicks on the Motor canvas.
            const snapped = VirtualDisplay.snapSize(
                Math.max(1, this._width),
                Math.max(1, this._height),
            );
            const result = await this._cdp.send('Page.captureScreenshot', {
                format: 'jpeg',
                quality: 80,
                fromSurface: true,
                clip: { x: 0, y: 0, width: snapped.width, height: snapped.height, scale: 1 },
            }) as { data: string };
            if (this._stopped || !this._onFrame || !result?.data) return;
            this._lastFrameAt = Date.now();
            this._onFrame(encodeScreencastFrame(Buffer.from(result.data, 'base64')));
        } catch {
            // CDP may be mid-navigation; skip this tick.
        } finally {
            this._idleBusy = false;
        }
    }
}
