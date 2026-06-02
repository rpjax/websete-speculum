import { CDPSession } from 'patchright';
import { encodeScreencastFrame } from './Protocol';

/**
 * Captures frames from the virtual browser via CDP Page.startScreencast.
 *
 * Chrome pushes JPEG frames to us — no polling loop, no FFmpeg, no Xvfb read.
 * Each frame is ACKed immediately (fire-and-forget) so Chrome sends the next
 * frame without waiting for a full round-trip, maximising throughput.
 *
 * ── Resize ───────────────────────────────────────────────────────────────────
 * Call restart(w, h, onFrame) instead of stop()+start(). This stops the
 * current screencast and restarts it with new maxWidth/maxHeight hints.
 * Emulation.setDeviceMetricsOverride should be called before restart() so
 * Chrome's renderer has already switched to the new viewport when the first
 * new frame arrives.
 *
 * ── Listener lifetime ────────────────────────────────────────────────────────
 * We store a reference to the current Page.screencastFrame handler and
 * explicitly remove it before re-attaching on restart(), so there is never
 * more than one active listener on the CDPSession at a time.
 */
export class ScreencastCapture {
    private _cdp:     CDPSession;
    private _stopped: boolean                           = false;
    private _handler: ((event: unknown) => void) | null = null;

    private constructor(cdp: CDPSession) {
        this._cdp = cdp;
    }

    // ── Factory ───────────────────────────────────────────────────────────────

    static async start(
        cdp:     CDPSession,
        width:   number,
        height:  number,
        onFrame: (buf: Buffer) => void,
    ): Promise<ScreencastCapture> {
        const sc = new ScreencastCapture(cdp);
        await sc._attach(width, height, onFrame);
        return sc;
    }

    // ── Restart on resize ─────────────────────────────────────────────────────

    async restart(
        width:   number,
        height:  number,
        onFrame: (buf: Buffer) => void,
    ): Promise<void> {
        if (this._stopped) return;
        try { await this._cdp.send('Page.stopScreencast', {}); } catch { /* best-effort */ }
        await this._attach(width, height, onFrame);
    }

    // ── Stop ──────────────────────────────────────────────────────────────────

    async stop(): Promise<void> {
        if (this._stopped) return;
        this._stopped = true;

        if (this._handler) {
            this._cdp.off('Page.screencastFrame', this._handler);
            this._handler = null;
        }

        try { await this._cdp.send('Page.stopScreencast', {}); } catch { /* best-effort */ }
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _attach(
        width:   number,
        height:  number,
        onFrame: (buf: Buffer) => void,
    ): Promise<void> {
        // Remove the previous listener so we never double-fire.
        if (this._handler) {
            this._cdp.off('Page.screencastFrame', this._handler);
        }

        const cdp  = this._cdp;
        const self = this;

        this._handler = function screencastFrameHandler(event: unknown): void {
            if (self._stopped) return;
            const ev = event as { data: string; sessionId: number };

            // ACK immediately — fire-and-forget.
            // Chrome will NOT send the next frame until it receives the ACK for
            // the current one, so we must send it before doing any heavy work.
            cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});

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
    }
}
