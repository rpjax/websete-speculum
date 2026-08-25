"use strict";
/**
 * ABS uinput stack for unified PP input (D-UI-02 / D-UI-20).
 * Opens ABS pointer + keyboard (+ multitouch stub for Xorg InputDevice list),
 * mknods event nodes, exposes writers for AbsPointerPeripheral / KeyboardPeripheral.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbsOsInputStack = void 0;
const node_crypto_1 = require("node:crypto");
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const uinput_1 = require("../patchright/input/uinput");
const keycodes_1 = require("../patchright/input/keycodes");
class AbsOsInputStack {
    absMaxX;
    absMaxY;
    pointer;
    keyboard;
    touch;
    pointerWriter;
    keyboardWriter;
    disposed = false;
    constructor(pointer, keyboard, touch, absMaxX, absMaxY) {
        this.absMaxX = absMaxX;
        this.absMaxY = absMaxY;
        this.pointer = pointer;
        this.keyboard = keyboard;
        this.touch = touch;
        this.pointerWriter = {
            writeAbs: (x, y) => this.writeAbs(x, y),
            writeBtn: (btn, down) => this.writeBtn(btn, down),
            releaseAll: () => this.releasePointer(),
        };
        this.keyboardWriter = {
            writeKey: (code, down, _modifiers) => this.writeKey(code, down),
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
        ensureInputEventNodes(pointer.name, keyboard.name, touch.name);
        return new AbsOsInputStack(pointer, keyboard, touch, absMaxX, absMaxY);
    }
    displayInputDevices() {
        const handlers = listInputHandlers(this.pointer.name, this.keyboard.name, this.touch.name);
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
        const xi = clamp(Math.round(x), 0, this.absMaxX);
        const yi = clamp(Math.round(y), 0, this.absMaxY);
        this.pointer.emit([
            { type: uinput_1.EV_ABS, code: uinput_1.ABS_X, value: xi },
            { type: uinput_1.EV_ABS, code: uinput_1.ABS_Y, value: yi },
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
    writeKey(code, down) {
        const stroke = (0, keycodes_1.resolveKeyStroke)(code);
        if (!stroke)
            return;
        this.keyboard.emit([{ type: uinput_1.EV_KEY, code: stroke.code, value: down ? 1 : 0 }]);
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
function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}
function listInputHandlers(...deviceNames) {
    const wanted = new Set(deviceNames.filter((n) => n.length > 0));
    if (wanted.size === 0)
        return [];
    let text;
    try {
        text = fs.readFileSync('/proc/bus/input/devices', 'utf8');
    }
    catch {
        return [];
    }
    const out = [];
    for (const block of text.split('\n\n')) {
        const nameMatch = block.match(/^N: Name="([^"]+)"/m);
        const handlersMatch = block.match(/^H: Handlers=([^\n]+)/m);
        if (!nameMatch || !handlersMatch)
            continue;
        if (!wanted.has(nameMatch[1]))
            continue;
        for (const token of handlersMatch[1].trim().split(/\s+/)) {
            if (!/^event\d+$/.test(token))
                continue;
            out.push({ name: nameMatch[1], event: token });
        }
    }
    return out;
}
function ensureInputEventNodes(...deviceNames) {
    try {
        fs.mkdirSync('/dev/input', { recursive: true });
    }
    catch {
        /* */
    }
    for (const { event } of listInputHandlers(...deviceNames)) {
        const node = `/dev/input/${event}`;
        if (fs.existsSync(node))
            continue;
        let majMin;
        try {
            majMin = fs.readFileSync(`/sys/class/input/${event}/dev`, 'utf8').trim();
        }
        catch {
            continue;
        }
        const [majS, minS] = majMin.split(':');
        const major = Number(majS);
        const minor = Number(minS);
        if (!Number.isInteger(major) || !Number.isInteger(minor))
            continue;
        try {
            (0, node_child_process_1.execFileSync)('mknod', [node, 'c', String(major), String(minor)]);
            fs.chmodSync(node, 0o666);
        }
        catch {
            /* */
        }
    }
}
//# sourceMappingURL=AbsOsInputStack.js.map