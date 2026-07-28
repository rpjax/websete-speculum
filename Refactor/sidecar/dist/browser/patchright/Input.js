"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InputController = void 0;
function mouseButtonName(b) {
    if (b === 1)
        return 'middle';
    if (b === 2)
        return 'right';
    if (b === 0)
        return 'left';
    return 'none';
}
function mouseButtonMask(b) {
    if (b === 0)
        return 1;
    if (b === 1)
        return 4;
    if (b === 2)
        return 2;
    return 0;
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
/** Text for Input.dispatchKeyEvent so Enter/Tab/printable trigger default actions. */
function keyText(key) {
    if (key === 'Enter')
        return '\r';
    if (key === 'Tab')
        return '\t';
    if (key === ' ')
        return ' ';
    if (key.length === 1)
        return key;
    return undefined;
}
/**
 * Pointer/key/touch → Chrome Input.* domain, fire-and-forget.
 * Does not await CDP; does not serialize behind navigate/resize.
 * History nav is also non-blocking (void) so it cannot stall the input path.
 */
class InputController {
    _page;
    _cdp;
    _touchPrimary = false;
    _buttons = 0;
    _movePending = null;
    _moveScheduled = false;
    _inFlight = 0;
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
    /** Admission is synchronous — CDP work is scheduled without awaiting. */
    enqueue(input) {
        try {
            this.dispatch(input);
        }
        catch (err) {
            console.warn('[Input] error:', err.message);
        }
    }
    dispatch(input) {
        switch (input.type) {
            case 'mousemove':
                if (this._touchPrimary)
                    return;
                this._queueMouseMove(input.x, input.y);
                return;
            case 'mousedown':
                if (this._touchPrimary)
                    return;
                this._buttons |= mouseButtonMask(input.button);
                this._sendMouse('mousePressed', input.x, input.y, input.button, 1);
                return;
            case 'mouseup':
                if (this._touchPrimary)
                    return;
                this._buttons &= ~mouseButtonMask(input.button);
                this._sendMouse('mouseReleased', input.x, input.y, input.button, 1);
                return;
            case 'wheel':
                if (this._touchPrimary) {
                    this._sendWheel(input.x, input.y, input.deltaX, input.deltaY);
                    return;
                }
                this._sendMouse('mouseMoved', input.x, input.y, -1, 0);
                this._sendWheel(input.x, input.y, input.deltaX, input.deltaY);
                return;
            case 'keydown':
                this._sendKey('keyDown', input.key);
                return;
            case 'keyup':
                this._sendKey('keyUp', input.key);
                return;
            case 'type':
            case 'text':
                this._ff('Input.insertText', { text: input.text });
                return;
            case 'touch':
                this._dispatchTouch(input.phase, [...input.points]);
                return;
            case 'goback':
                // History is not pointer/key — never await on the input path.
                void this._page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((err) => {
                    console.warn('[Input] goback:', err.message);
                });
                return;
            case 'goforward':
                void this._page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((err) => {
                    console.warn('[Input] goforward:', err.message);
                });
                return;
        }
    }
    _queueMouseMove(x, y) {
        this._movePending = { x, y };
        if (this._moveScheduled)
            return;
        this._moveScheduled = true;
        setImmediate(() => {
            this._moveScheduled = false;
            const p = this._movePending;
            this._movePending = null;
            if (!p || this._touchPrimary)
                return;
            this._sendMouse('mouseMoved', p.x, p.y, -1, 0);
        });
    }
    _sendMouse(type, x, y, button, clickCount) {
        this._ff('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: type === 'mouseMoved' ? 'none' : mouseButtonName(button),
            buttons: this._buttons,
            clickCount,
        });
    }
    _sendWheel(x, y, deltaX, deltaY) {
        this._ff('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x,
            y,
            deltaX,
            deltaY,
            button: 'none',
            buttons: this._buttons,
        });
    }
    _sendKey(type, key) {
        const text = type === 'keyDown' ? keyText(key) : undefined;
        const params = {
            type: text && type === 'keyDown' ? 'keyDown' : type === 'keyDown' ? 'rawKeyDown' : 'keyUp',
            key,
        };
        if (text) {
            params.text = text;
            params.unmodifiedText = text;
        }
        this._ff('Input.dispatchKeyEvent', params);
    }
    _dispatchTouch(phase, points) {
        const type = cdpTouchType(phase);
        if (type === 'touchEnd' || type === 'touchCancel') {
            this._ff('Input.dispatchTouchEvent', { type, touchPoints: [] });
            if (points.length > 0) {
                this._ff('Input.dispatchTouchEvent', {
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
        this._ff('Input.dispatchTouchEvent', {
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
    _ff(method, params) {
        this._inFlight++;
        void this._cdp
            .send(method, params)
            .catch((err) => {
            console.warn(`[Input] ${method}:`, err.message);
        })
            .finally(() => {
            this._inFlight = Math.max(0, this._inFlight - 1);
        });
    }
    get pendingCount() {
        return this._inFlight + (this._movePending ? 1 : 0);
    }
}
exports.InputController = InputController;
//# sourceMappingURL=Input.js.map