"use strict";
/**
 * Sparse CDP-backed input adapter — sole PageProjection input path
 * (decision-log.md 2026-08-27).
 *
 * Closed catalog: `click` (single moveTo+press+release); keyboard uses `intent.key`
 * (wire canonical): non-ASCII single code unit → `Input.insertText`; ASCII printable
 * (incl. space) + editing/special keys → lazy Playwright `page.keyboard.down/up`
 * (same shape as PatchrightInputBackend).
 * `scrollSet` goes through the session's loopback data plane — adapter-agnostic.
 *
 * Explicitly NOT supported: continuous pointer move / hover / drag. See input.md §7.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SparseCdpKeyboardPeripheral = exports.SparseCdpPointerPeripheral = void 0;
exports.openSparseCdpInputAdapter = openSparseCdpInputAdapter;
const BUTTON_MASK = { left: 1, right: 2, middle: 4 };
class SparseCdpPointerPeripheral {
    send;
    chain = Promise.resolve();
    lastX = 0;
    lastY = 0;
    awaitingButton = false;
    rejectedMoves = 0;
    constructor(send) {
        this.send = send;
    }
    moveTo(x, y) {
        if (this.awaitingButton) {
            this.rejectedMoves++;
            return;
        }
        this.awaitingButton = true;
        this.lastX = x;
        this.lastY = y;
        this.enqueue(() => this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }));
    }
    button(btn, down) {
        this.awaitingButton = false;
        const x = this.lastX;
        const y = this.lastY;
        this.enqueue(() => this.send('Input.dispatchMouseEvent', {
            type: down ? 'mousePressed' : 'mouseReleased',
            x,
            y,
            button: btn,
            buttons: down ? BUTTON_MASK[btn] : 0,
            clickCount: 1,
        }));
    }
    sanitize() {
        this.awaitingButton = false;
        const x = this.lastX;
        const y = this.lastY;
        this.enqueue(() => this.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            buttons: 0,
            clickCount: 1,
        }));
    }
    get rejectedContinuousMoveCount() {
        return this.rejectedMoves;
    }
    flush() {
        return this.chain;
    }
    enqueue(fn) {
        this.chain = this.chain.then(fn).then(() => undefined, () => undefined);
    }
}
exports.SparseCdpPointerPeripheral = SparseCdpPointerPeripheral;
/**
 * Keyboard: non-ASCII insertText (down edge); ASCII + named keys via Playwright keyboard.
 */
class SparseCdpKeyboardPeripheral {
    send;
    keyboard;
    chain = Promise.resolve();
    rejectedKeys = 0;
    constructor(send, keyboard) {
        this.send = send;
        this.keyboard = keyboard;
    }
    key(key, down, _modifiers) {
        if (!key) {
            this.rejectedKeys++;
            return;
        }
        if (key.length === 1 && key.charCodeAt(0) > 127) {
            if (down)
                this.enqueue(() => this.send('Input.insertText', { text: key }));
            return;
        }
        this.enqueue(() => (down ? this.keyboard.down(key) : this.keyboard.up(key)));
    }
    sanitize() {
        /* edge-triggered; nothing to release */
    }
    get rejectedKeyCount() {
        return this.rejectedKeys;
    }
    flush() {
        return this.chain;
    }
    enqueue(fn) {
        this.chain = this.chain.then(fn).then(() => undefined, () => undefined);
    }
}
exports.SparseCdpKeyboardPeripheral = SparseCdpKeyboardPeripheral;
function openSparseCdpInputAdapter(opts) {
    const send = opts.cdp.send.bind(opts.cdp);
    const pointer = new SparseCdpPointerPeripheral(send);
    const keyboard = new SparseCdpKeyboardPeripheral(send, opts.keyboard);
    return {
        kind: 'sparse-cdp',
        pointer,
        keyboard,
        setLogicalSize() { },
        dispose() { },
    };
}
//# sourceMappingURL=sparseCdpInputAdapter.js.map