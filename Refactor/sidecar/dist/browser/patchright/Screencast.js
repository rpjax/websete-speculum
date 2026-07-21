"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Screencast = void 0;
const jpeg_geometry_1 = require("./jpeg-geometry");
/**
 * CDP Page.startScreencast → raw JPEG bytes (no wire framing).
 */
class Screencast {
    _cdp;
    _stopped = false;
    _handler = null;
    _idleTimer = null;
    _lastFrameAt = 0;
    _idleBusy = false;
    _width = 0;
    _height = 0;
    _onFrame = null;
    static IDLE_MS = 750;
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
    async restart(width, height, onFrame, cdp) {
        if (this._stopped)
            return;
        this._clearIdleTimer();
        try {
            await this._cdp.send('Page.stopScreencast', {});
        }
        catch {
            /* best-effort */
        }
        if (cdp)
            this._cdp = cdp;
        await this._attach(width, height, onFrame);
    }
    async stop() {
        if (this._stopped)
            return;
        this._stopped = true;
        this._clearIdleTimer();
        if (this._handler) {
            this._cdp.off('Page.screencastFrame', this._handler);
            this._handler = null;
        }
        this._onFrame = null;
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
        }
        const cdp = this._cdp;
        const self = this;
        this._onFrame = onFrame;
        this._width = width;
        this._height = height;
        this._lastFrameAt = Date.now();
        this._handler = function screencastFrameHandler(event) {
            if (self._stopped)
                return;
            const ev = event;
            cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => { });
            const jpeg = Buffer.from(ev.data, 'base64');
            if (!self._jpegMatchesViewport(jpeg))
                return;
            self._lastFrameAt = Date.now();
            onFrame(new Uint8Array(jpeg));
        };
        this._cdp.on('Page.screencastFrame', this._handler);
        await this._cdp.send('Page.startScreencast', {
            format: 'jpeg',
            quality: 80,
            maxWidth: 4096,
            maxHeight: 2160,
            everyNthFrame: 1,
        });
        this._armIdleTimer();
    }
    _armIdleTimer() {
        this._clearIdleTimer();
        this._idleTimer = setInterval(() => {
            void this._maybeIdleScreenshot();
        }, Screencast.IDLE_MS);
    }
    _clearIdleTimer() {
        if (this._idleTimer) {
            clearInterval(this._idleTimer);
            this._idleTimer = null;
        }
    }
    async _maybeIdleScreenshot() {
        if (this._stopped || this._idleBusy || !this._onFrame)
            return;
        if (Date.now() - this._lastFrameAt < Screencast.IDLE_MS)
            return;
        this._idleBusy = true;
        try {
            const result = (await this._cdp.send('Page.captureScreenshot', {
                format: 'jpeg',
                quality: 80,
            }));
            const jpeg = Buffer.from(result.data, 'base64');
            if (!this._jpegMatchesViewport(jpeg))
                return;
            this._lastFrameAt = Date.now();
            this._onFrame(new Uint8Array(jpeg));
        }
        catch {
            /* best-effort */
        }
        finally {
            this._idleBusy = false;
        }
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