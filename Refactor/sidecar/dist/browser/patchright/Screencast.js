"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Screencast = void 0;
const jpeg_geometry_1 = require("./jpeg-geometry");
/**
 * CDP Page.startScreencast → raw JPEG bytes (no wire framing).
 * Encode maxWidth/maxHeight track the logical viewport so cost follows client size.
 *
 * Idle pages keep the last screencast frame — do not inject Page.captureScreenshot
 * kick frames (clip-at-origin mismatches the scrolled viewport and "pushes" content).
 */
class Screencast {
    _cdp;
    _stopped = false;
    _handler = null;
    _width = 0;
    _height = 0;
    constructor(cdp) {
        this._cdp = cdp;
    }
    static async start(cdp, width, height, onFrame) {
        const sc = new Screencast(cdp);
        await sc._attach(width, height, onFrame);
        return sc;
    }
    setViewport(width, height) {
        this._width = width;
        this._height = height;
    }
    /**
     * Stop + reattach at a new logical size. Throws if already stopped (live resize
     * must not silently no-op after stopScreencast).
     */
    async restart(width, height, onFrame, cdp) {
        await this.pauseForRestart();
        if (cdp)
            this._cdp = cdp;
        await this.completeRestart(width, height, onFrame);
    }
    /**
     * Stop casting and clear the handler without marking the screencast stopped.
     * Call before applying new logical metrics so old-size frames are not filtered
     * into a black gap; pair with {@link completeRestart}.
     */
    async pauseForRestart() {
        if (this._stopped) {
            throw new Error('screencast restart after stop');
        }
        try {
            await this._cdp.send('Page.stopScreencast', {});
        }
        catch {
            /* best-effort */
        }
        if (this._handler) {
            this._cdp.off('Page.screencastFrame', this._handler);
            this._handler = null;
        }
    }
    /** Reattach after {@link pauseForRestart} at the new encode size. */
    async completeRestart(width, height, onFrame, cdp) {
        if (this._stopped) {
            throw new Error('screencast restart after stop');
        }
        if (cdp)
            this._cdp = cdp;
        await this._attach(width, height, onFrame);
    }
    async stop() {
        if (this._stopped)
            return;
        this._stopped = true;
        if (this._handler) {
            this._cdp.off('Page.screencastFrame', this._handler);
            this._handler = null;
        }
        try {
            await this._cdp.send('Page.stopScreencast', {});
        }
        catch {
            /* best-effort */
        }
    }
    async _attach(width, height, onFrame) {
        if (this._handler) {
            this._cdp.off('Page.screencastFrame', this._handler);
            this._handler = null;
        }
        const cdp = this._cdp;
        const self = this;
        const prevW = this._width;
        const prevH = this._height;
        // Commit expected filter dims before start so early frames are not dropped/mismatched.
        this._width = width;
        this._height = height;
        const handler = function screencastFrameHandler(event) {
            if (self._stopped)
                return;
            const ev = event;
            cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => { });
            const jpeg = Buffer.from(ev.data, 'base64');
            if (!self._jpegMatchesViewport(jpeg))
                return;
            onFrame(new Uint8Array(jpeg));
        };
        this._cdp.on('Page.screencastFrame', handler);
        try {
            await this._cdp.send('Page.startScreencast', {
                format: 'jpeg',
                quality: 80,
                maxWidth: width,
                maxHeight: height,
                everyNthFrame: 1,
            });
        }
        catch (err) {
            this._cdp.off('Page.screencastFrame', handler);
            this._width = prevW;
            this._height = prevH;
            throw err;
        }
        this._handler = handler;
    }
    _jpegMatchesViewport(jpeg) {
        if (this._width <= 0 || this._height <= 0)
            return true;
        const dims = (0, jpeg_geometry_1.readJpegDimensions)(jpeg);
        if (!dims)
            return true;
        const dw = Math.abs(dims.width - this._width);
        const dh = Math.abs(dims.height - this._height);
        return dw <= 2 && dh <= 2;
    }
}
exports.Screencast = Screencast;
//# sourceMappingURL=Screencast.js.map