"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatchrightInputBackend = void 0;
function mouseButtonName(b) {
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
/**
 * Patchright/CDP input path — lab/tests and hosts without uinput.
 * One CDP round-trip per gesture (no redundant page.mouse.move before down/up/wheel).
 */
class PatchrightInputBackend {
    _page;
    _cdp;
    constructor(page, cdp) {
        this._page = page;
        this._cdp = cdp;
    }
    rebind(page, cdp) {
        this._page = page;
        this._cdp = cdp;
    }
    get cdp() {
        return this._cdp;
    }
    async move(x, y) {
        await this.cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x,
            y,
        });
    }
    async down(button, x, y) {
        await this.cdp.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x,
            y,
            button: mouseButtonName(button),
            buttons: buttonMask(button),
            clickCount: 1,
        });
    }
    async up(button, x, y) {
        await this.cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: mouseButtonName(button),
            buttons: 0,
            clickCount: 1,
        });
    }
    async wheel(x, y, deltaX, deltaY) {
        await this.cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x,
            y,
            deltaX,
            deltaY,
        });
    }
    async keyDown(key) {
        if (key.length === 1 && key.charCodeAt(0) > 127) {
            await this.cdp.send('Input.insertText', { text: key });
            return;
        }
        await this._page.keyboard.down(key);
    }
    async keyUp(key) {
        if (key.length === 1 && key.charCodeAt(0) > 127)
            return;
        await this._page.keyboard.up(key);
    }
    async typeText(text) {
        // One CDP call — not character-by-character keyboard.type.
        await this.cdp.send('Input.insertText', { text });
    }
    async touch(phase, points) {
        const type = cdpTouchType(phase);
        if (type === 'touchEnd' || type === 'touchCancel') {
            await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
            if (points.length > 0) {
                await this.cdp.send('Input.dispatchTouchEvent', {
                    type: 'touchStart',
                    touchPoints: points.map(toCdpTouch),
                });
            }
            return;
        }
        await this.cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: points.map(toCdpTouch),
        });
    }
    async dispose() {
        /* nothing to release */
    }
}
exports.PatchrightInputBackend = PatchrightInputBackend;
function toCdpTouch(p) {
    return {
        x: p.x,
        y: p.y,
        id: p.id,
        radiusX: p.radiusX,
        radiusY: p.radiusY,
        force: p.force,
    };
}
function buttonMask(button) {
    if (button === 1)
        return 4;
    if (button === 2)
        return 2;
    return 1;
}
//# sourceMappingURL=PatchrightInputBackend.js.map