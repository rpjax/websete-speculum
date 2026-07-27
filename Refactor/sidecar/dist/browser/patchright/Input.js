"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InputController = void 0;
function domButton(b) {
    if (b === 1)
        return 'middle';
    if (b === 2)
        return 'right';
    return 'left';
}
function cdpTouchType(phase) {
    switch (phase) {
        case 'move':
            return 'touchMove';
        case 'end':
            return 'touchEnd';
        case 'cancel':
            return 'touchCancel';
        default:
            return 'touchStart';
    }
}
/** Coalesce high-frequency pointer moves; decisive input is serialized. */
class InputController {
    _page;
    _cdp;
    _chain = Promise.resolve();
    _touchPrimary = false;
    _movePending = null;
    _moveScheduled = false;
    /**
     * Nestable suspend depth (navigate / soft resize / refresh).
     * Input stays paused while depth > 0 so overlapping ops cannot clear each other.
     */
    _suspendDepth = 0;
    constructor(page, cdp) {
        this._page = page;
        this._cdp = cdp;
    }
    rebind(page, cdp) {
        this._page = page;
        this._cdp = cdp;
    }
    setTouchPrimary(value) {
        this._touchPrimary = value;
    }
    /** Nestable pause — pair with {@link endSuspend} in finally. */
    beginSuspend() {
        this._suspendDepth++;
        this._movePending = null;
    }
    /** Nestable resume — only clears pause when the last suspend ends. */
    endSuspend() {
        if (this._suspendDepth > 0) {
            this._suspendDepth--;
        }
    }
    /**
     * @deprecated Prefer beginSuspend/endSuspend — boolean overwrite races overlapping ops.
     * Kept as depth++ / depth-- for call-site compatibility.
     */
    setSuspended(value) {
        if (value)
            this.beginSuspend();
        else
            this.endSuspend();
    }
    get suspended() {
        return this._suspendDepth > 0;
    }
    /** Await in-flight dispatch so soft resize does not race mid-click. */
    async drain() {
        this._movePending = null;
        await this._chain;
    }
    enqueue(input) {
        if (this._suspendDepth > 0)
            return;
        this._chain = this._chain
            .then(() => {
            if (this._suspendDepth > 0)
                return;
            return this.dispatch(input);
        })
            .catch((err) => {
            console.warn('[Input] error:', err.message);
        });
    }
    async dispatch(input) {
        switch (input.type) {
            case 'mousemove':
                if (this._touchPrimary)
                    return;
                this._queueMouseMove(input.x, input.y);
                return;
            case 'mousedown':
                if (this._touchPrimary)
                    return;
                await this._page.mouse.move(input.x, input.y);
                await this._page.mouse.down({ button: domButton(input.button) });
                return;
            case 'mouseup':
                if (this._touchPrimary)
                    return;
                await this._page.mouse.move(input.x, input.y);
                await this._page.mouse.up({ button: domButton(input.button) });
                return;
            case 'wheel': {
                if (!this._touchPrimary)
                    await this._page.mouse.move(input.x, input.y);
                await this._page.mouse.wheel(input.deltaX, input.deltaY);
                return;
            }
            case 'keydown':
                await this._page.keyboard.down(input.key);
                return;
            case 'keyup':
                await this._page.keyboard.up(input.key);
                return;
            case 'type':
                await this._page.keyboard.type(input.text);
                return;
            case 'text':
                await this._page.keyboard.insertText(input.text);
                return;
            case 'touch':
                await this._dispatchTouch(input.phase, [...input.points]);
                return;
            case 'goback':
                await this._page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 });
                return;
            case 'goforward':
                await this._page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 });
                return;
        }
    }
    _queueMouseMove(x, y) {
        if (this._suspendDepth > 0)
            return;
        this._movePending = { x, y };
        if (this._moveScheduled)
            return;
        this._moveScheduled = true;
        setImmediate(() => {
            this._moveScheduled = false;
            const p = this._movePending;
            this._movePending = null;
            if (!p || this._touchPrimary || this._suspendDepth > 0)
                return;
            try {
                void this._page.mouse.move(p.x, p.y).catch(() => { });
            }
            catch {
                /* frame detached mid-move */
            }
        });
    }
    async _dispatchTouch(phase, points) {
        const type = cdpTouchType(phase);
        if (type === 'touchEnd' || type === 'touchCancel') {
            // CDP requires empty touchPoints on end/cancel; re-assert remaining contacts.
            await this._cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
            if (points.length > 0) {
                await this._cdp.send('Input.dispatchTouchEvent', {
                    type: 'touchStart',
                    touchPoints: points.map((p) => ({
                        x: p.x,
                        y: p.y,
                        id: p.id,
                        radiusX: p.radiusX,
                        radiusY: p.radiusY,
                        force: p.force,
                    })),
                });
            }
            return;
        }
        await this._cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: points.map((p) => ({
                x: p.x,
                y: p.y,
                id: p.id,
                radiusX: p.radiusX,
                radiusY: p.radiusY,
                force: p.force,
            })),
        });
    }
}
exports.InputController = InputController;
//# sourceMappingURL=Input.js.map