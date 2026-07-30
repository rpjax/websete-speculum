"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TouchMoveCoalescer = void 0;
/**
 * Latest-wins coalesce for high-frequency touchmove — drops intermediate samples
 * so the inject queue does not back up behind every pointer sample.
 */
class TouchMoveCoalescer {
    _flush;
    _schedule;
    _pending = null;
    _scheduled = false;
    _epoch = 0;
    constructor(_flush, _schedule = (fn) => setImmediate(fn)) {
        this._flush = _flush;
        this._schedule = _schedule;
    }
    queue(points) {
        this._pending = points;
        if (this._scheduled)
            return;
        this._scheduled = true;
        const epoch = this._epoch;
        this._schedule(() => {
            if (epoch !== this._epoch)
                return;
            this._flushPending();
        });
    }
    /**
     * Steal pending points and cancel a scheduled flush so the caller can
     * dispatch them synchronously before touch end/cancel/start.
     */
    takePending() {
        this._epoch++;
        this._scheduled = false;
        const pending = this._pending;
        this._pending = null;
        return pending;
    }
    _flushPending() {
        this._scheduled = false;
        const pending = this._pending;
        this._pending = null;
        if (!pending)
            return;
        this._flush(pending);
    }
}
exports.TouchMoveCoalescer = TouchMoveCoalescer;
//# sourceMappingURL=TouchMoveCoalescer.js.map