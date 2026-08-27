"use strict";
/**
 * ABS uinput stack for unified PP input (D-UI-02 / D-UI-20).
 * Opens ABS pointer + keyboard (+ multitouch stub for Xorg InputDevice list),
 * mknods event nodes, exposes writers for AbsPointerPeripheral / KeyboardPeripheral.
 *
 * Coordinate law (D-UI-04): client CSS (x,y) maps 1:1 into ABS via
 * {@link mapLogicalToAbs} — no chrome-inset calibration.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbsOsInputStack = void 0;
const node_crypto_1 = require("node:crypto");
const uinput_1 = require("./os/uinput");
const logical_to_device_1 = require("./os/logical-to-device");
const keycodes_1 = require("./os/keycodes");
const eventNodes_1 = require("./os/eventNodes");
class AbsOsInputStack {
    pointer;
    keyboard;
    touch;
    pointerWriter;
    keyboardWriter;
    disposed = false;
    transform;
    constructor(pointer, keyboard, touch, transform) {
        this.pointer = pointer;
        this.keyboard = keyboard;
        this.touch = touch;
        this.transform = transform;
        this.pointerWriter = {
            writeAbs: (x, y) => this.writeAbs(x, y),
            writeBtn: (btn, down) => this.writeBtn(btn, down),
            releaseAll: () => this.releasePointer(),
        };
        this.keyboardWriter = {
            writeKey: (code, down, modifiers) => this.writeKey(code, down, modifiers),
            releaseAll: () => {
                /* keys are edge-triggered */
            },
        };
    }
    static open(opts) {
        if (!(0, uinput_1.uinputAvailable)()) {
            throw Object.assign(new Error('/dev/uinput is not available'), {
                code: 'FAILED_PRECONDITION',
                errorCode: 'uinput_unavailable',
                phase: 'launch',
            });
        }
        const absMaxX = Math.max(0, opts.displayWidth - 1);
        const absMaxY = Math.max(0, opts.displayHeight - 1);
        const logicalW = opts.logicalWidth ?? opts.displayWidth;
        const logicalH = opts.logicalHeight ?? opts.displayHeight;
        const transform = logicalW === opts.displayWidth && logicalH === opts.displayHeight
            ? (0, logical_to_device_1.createLogicalWindowTransform)(logicalW, logicalH)
            : (0, logical_to_device_1.createCoordTransform)(logicalW, logicalH, absMaxX, absMaxY);
        const shortId = (0, node_crypto_1.createHash)('sha1').update(opts.sessionId).digest('hex').slice(0, 12);
        const pointer = uinput_1.UinputDevice.openAbsPointer(`speculum-abs-${shortId}`, absMaxX, absMaxY);
        let keyboard;
        try {
            keyboard = uinput_1.UinputDevice.openKeyboard(`speculum-kbd-${shortId}`, (0, keycodes_1.allKeyboardKeyCodes)());
        }
        catch (err) {
            pointer.destroy();
            throw err;
        }
        let touch;
        try {
            touch = uinput_1.UinputDevice.openMultitouch(`speculum-mt-${shortId}`, absMaxX, absMaxY, 10);
        }
        catch (err) {
            pointer.destroy();
            keyboard.destroy();
            throw err;
        }
        (0, eventNodes_1.ensureInputEventNodes)(pointer.name, keyboard.name, touch.name);
        return new AbsOsInputStack(pointer, keyboard, touch, transform);
    }
    /** Refresh logical viewport after soft-resize — ABS capacity stays at R. */
    setLogicalSize(logicalWidth, logicalHeight) {
        this.transform = (0, logical_to_device_1.createCoordTransform)(logicalWidth, logicalHeight, Math.max(0, this.transform.absMaxX), Math.max(0, this.transform.absMaxY));
    }
    /** Identity transform used by the pointer writer (tests / diagnostics). */
    getCoordTransform() {
        return this.transform;
    }
    displayInputDevices() {
        const handlers = (0, eventNodes_1.listInputHandlers)(this.pointer.name, this.keyboard.name, this.touch.name);
        const ptr = handlers.find((h) => h.name === this.pointer.name);
        const kbd = handlers.find((h) => h.name === this.keyboard.name);
        const mt = handlers.find((h) => h.name === this.touch.name);
        if (!ptr || !kbd || !mt) {
            throw Object.assign(new Error(`uinput event nodes missing after create (${this.pointer.name}, ${this.keyboard.name}, ${this.touch.name})`), { code: 'FAILED_PRECONDITION', errorCode: 'uinput_event_missing', phase: 'launch' });
        }
        return {
            pointerEventPath: `/dev/input/${ptr.event}`,
            keyboardEventPath: `/dev/input/${kbd.event}`,
            touchEventPath: `/dev/input/${mt.event}`,
            pointerName: this.pointer.name,
            keyboardName: this.keyboard.name,
            touchName: this.touch.name,
        };
    }
    writeAbs(x, y) {
        const m = (0, logical_to_device_1.mapLogicalToAbs)(this.transform, x, y);
        this.pointer.emit([
            { type: uinput_1.EV_ABS, code: uinput_1.ABS_X, value: m.x },
            { type: uinput_1.EV_ABS, code: uinput_1.ABS_Y, value: m.y },
        ]);
    }
    writeBtn(btn, down) {
        const code = btn === 'middle' ? uinput_1.BTN_MIDDLE : btn === 'right' ? uinput_1.BTN_RIGHT : uinput_1.BTN_LEFT;
        this.pointer.emit([{ type: uinput_1.EV_KEY, code, value: down ? 1 : 0 }]);
    }
    releasePointer() {
        this.pointer.emit([
            { type: uinput_1.EV_KEY, code: uinput_1.BTN_LEFT, value: 0 },
            { type: uinput_1.EV_KEY, code: uinput_1.BTN_RIGHT, value: 0 },
            { type: uinput_1.EV_KEY, code: uinput_1.BTN_MIDDLE, value: 0 },
        ]);
    }
    writeKey(code, down, modifiers) {
        const stroke = (0, keycodes_1.resolveKeyStroke)(code);
        if (!stroke)
            return;
        const needShift = !!(stroke.shift || modifiers?.shift);
        if (needShift && down) {
            this.keyboard.emit([{ type: uinput_1.EV_KEY, code: keycodes_1.KEY.LEFTSHIFT, value: 1 }]);
        }
        this.keyboard.emit([{ type: uinput_1.EV_KEY, code: stroke.code, value: down ? 1 : 0 }]);
        if (needShift && !down) {
            this.keyboard.emit([{ type: uinput_1.EV_KEY, code: keycodes_1.KEY.LEFTSHIFT, value: 0 }]);
        }
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        try {
            this.releasePointer();
        }
        catch {
            /* */
        }
        this.pointer.destroy();
        this.keyboard.destroy();
        this.touch.destroy();
    }
}
exports.AbsOsInputStack = AbsOsInputStack;
//# sourceMappingURL=AbsOsInputStack.js.map