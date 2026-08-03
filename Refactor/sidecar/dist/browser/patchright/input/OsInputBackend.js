"use strict";
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
exports.OsInputBackend = void 0;
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const util_1 = require("util");
const keycodes_1 = require("./keycodes");
const logical_to_device_1 = require("./logical-to-device");
const uinput_1 = require("./uinput");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const MAX_SLOTS = 10;
/** Xorg already binds our InputDevice sections — assert should be near-instant. */
const ATTACH_TIMEOUT_MS = 3_000;
const ATTACH_POLL_MS = 10;
/** Evdev relative deltas are typically int8/int16-safe; chunk large warps. */
const REL_CHUNK = 127;
/**
 * Production OS input: dual persistent uinput devices (pointer+kbd, multitouch)
 * bound into the session Xorg via explicit InputDevice sections.
 *
 * Open kernel nodes *before* Display.start, then attach asserts xinput visibility.
 */
class OsInputBackend {
    _pointer;
    _keyboard;
    _touch;
    _displayEnv;
    _sessionId;
    _insertText;
    _transform;
    /** Display capacity for relative-pointer home reset (window may be smaller). */
    _displayAbsMaxX;
    _displayAbsMaxY;
    _slotById = new Map();
    _idBySlot = new Map();
    /** Explicit Shift key from the client (keydown Shift) — sticky until keyup Shift. */
    _shiftHeld = false;
    /**
     * Shift we raised ourselves for a shifted char (e.g. '!') when the client did
     * not send a separate Shift keydown — released on matching keyUp.
     */
    _shiftOwnedByChar = false;
    _disposed = false;
    _attached = false;
    /** Software cursor in display ABS space — relative mouse needs a known origin. */
    _curX = 0;
    _curY = 0;
    constructor(pointer, keyboard, touch, displayEnv, sessionId, transform, displayAbsMaxX, displayAbsMaxY, insertText) {
        this._pointer = pointer;
        this._keyboard = keyboard;
        this._touch = touch;
        this._displayEnv = displayEnv;
        this._sessionId = sessionId;
        this._transform = transform;
        this._displayAbsMaxX = displayAbsMaxX;
        this._displayAbsMaxY = displayAbsMaxY;
        this._insertText = insertText;
    }
    get deviceNames() {
        return [this._pointer.name, this._keyboard.name, this._touch.name];
    }
    /** Resolve /dev/input/eventN paths for xorg.conf InputDevice sections. */
    resolveEventPaths() {
        ensureInputEventNodes(this._pointer.name, this._keyboard.name, this._touch.name);
        const handlers = listInputHandlers(this._pointer.name, this._keyboard.name, this._touch.name);
        const ptr = handlers.find((h) => h.name === this._pointer.name);
        const kbd = handlers.find((h) => h.name === this._keyboard.name);
        const mt = handlers.find((h) => h.name === this._touch.name);
        if (!ptr || !kbd || !mt) {
            throw Object.assign(new Error(`uinput event nodes missing after create (${this._pointer.name}, ${this._keyboard.name}, ${this._touch.name})`), { code: 'FAILED_PRECONDITION', errorCode: 'uinput_event_missing', phase: 'launch' });
        }
        return {
            pointerEventPath: `/dev/input/${ptr.event}`,
            keyboardEventPath: `/dev/input/${kbd.event}`,
            touchEventPath: `/dev/input/${mt.event}`,
        };
    }
    /** Create kernel uinput nodes + /dev/input event nodes — call before Display.start. */
    static async open(opts) {
        if (!(0, uinput_1.uinputAvailable)()) {
            throw Object.assign(new Error('/dev/uinput is not available'), {
                code: 'FAILED_PRECONDITION',
                errorCode: 'uinput_unavailable',
                phase: 'launch',
            });
        }
        const absMaxX = Math.max(0, opts.displayWidth - 1);
        const absMaxY = Math.max(0, opts.displayHeight - 1);
        const shortId = (0, crypto_1.createHash)('sha1').update(opts.sessionId).digest('hex').slice(0, 12);
        const pointer = uinput_1.UinputDevice.openPointer(`speculum-ptr-${shortId}`);
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
            touch = uinput_1.UinputDevice.openMultitouch(`speculum-mt-${shortId}`, absMaxX, absMaxY, MAX_SLOTS);
        }
        catch (err) {
            pointer.destroy();
            keyboard.destroy();
            throw err;
        }
        const backend = new OsInputBackend(pointer, keyboard, touch, '', opts.sessionId, (0, logical_to_device_1.createLogicalWindowTransform)(opts.logicalWidth, opts.logicalHeight), absMaxX, absMaxY);
        ensureInputEventNodes(pointer.name, keyboard.name, touch.name);
        return backend;
    }
    setInsertText(insertText) {
        this._insertText = insertText;
    }
    /** After Display.start: assert our InputDevice identifiers appear on this DISPLAY. */
    async attachToDisplay(displayEnv) {
        if (this._attached) {
            this._displayEnv = displayEnv;
            return;
        }
        this._displayEnv = displayEnv;
        try {
            await this._awaitDevicesVisible();
            // Relative mouse: pin software cursor to top-left so later deltas are absolute.
            this._emitRel(-this._displayAbsMaxX - 64, -this._displayAbsMaxY - 64);
            this._curX = 0;
            this._curY = 0;
            this._attached = true;
        }
        catch (err) {
            await this.dispose();
            throw err;
        }
    }
    static async create(opts) {
        const backend = await OsInputBackend.open(opts);
        if (opts.insertText)
            backend.setInsertText(opts.insertText);
        await backend.attachToDisplay(opts.displayEnv);
        return backend;
    }
    setLogicalSize(logicalWidth, logicalHeight) {
        this._transform = (0, logical_to_device_1.createLogicalWindowTransform)(logicalWidth, logicalHeight);
    }
    async move(x, y) {
        this._ensureLive();
        this._pointerAbsMove(x, y);
    }
    async down(button, x, y) {
        this._ensureLive();
        this._pointerAbsMove(x, y);
        this._pointer.emit([{ type: uinput_1.EV_KEY, code: mouseBtn(button), value: 1 }]);
    }
    async up(button, x, y) {
        this._ensureLive();
        this._pointerAbsMove(x, y);
        this._pointer.emit([{ type: uinput_1.EV_KEY, code: mouseBtn(button), value: 0 }]);
    }
    async wheel(x, y, deltaX, deltaY) {
        this._ensureLive();
        this._pointerAbsMove(x, y);
        const events = [];
        const stepsY = wheelSteps(deltaY);
        if (stepsY !== 0)
            events.push({ type: uinput_1.EV_REL, code: uinput_1.REL_WHEEL, value: stepsY });
        const stepsX = wheelSteps(deltaX);
        if (stepsX !== 0)
            events.push({ type: uinput_1.EV_REL, code: uinput_1.REL_HWHEEL, value: stepsX });
        if (events.length === 0)
            return;
        this._pointer.emit(events);
    }
    async keyDown(key) {
        this._ensureLive();
        if (key.length === 1 && key.charCodeAt(0) > 127) {
            await this._emitText(key);
            return;
        }
        if (key === 'Shift') {
            this._shiftHeld = true;
            this._shiftOwnedByChar = false;
            this._keyboard.emit([{ type: uinput_1.EV_KEY, code: keycodes_1.KEY.LEFTSHIFT, value: 1 }]);
            return;
        }
        const stroke = (0, keycodes_1.resolveKeyStroke)(key);
        if (!stroke) {
            console.warn('[OsInput] unsupported keyDown:', key);
            return;
        }
        const events = [];
        // Client sends Shift as its own keydown; do not double-press when already held.
        // Only synthesize shift for shifted glyphs ('!', 'A') when Shift was not sent.
        if (stroke.shift && !this._shiftHeld) {
            events.push({ type: uinput_1.EV_KEY, code: keycodes_1.KEY.LEFTSHIFT, value: 1 });
            this._shiftHeld = true;
            this._shiftOwnedByChar = true;
        }
        events.push({ type: uinput_1.EV_KEY, code: stroke.code, value: 1 });
        this._keyboard.emit(events);
    }
    async keyUp(key) {
        this._ensureLive();
        if (key.length === 1 && key.charCodeAt(0) > 127)
            return;
        if (key === 'Shift') {
            this._shiftHeld = false;
            this._shiftOwnedByChar = false;
            this._keyboard.emit([{ type: uinput_1.EV_KEY, code: keycodes_1.KEY.LEFTSHIFT, value: 0 }]);
            return;
        }
        const stroke = (0, keycodes_1.resolveKeyStroke)(key);
        if (!stroke)
            return;
        const events = [
            { type: uinput_1.EV_KEY, code: stroke.code, value: 0 },
        ];
        // Never release sticky client Shift on keyUp('A') — only release shift we owned.
        if (stroke.shift && this._shiftOwnedByChar) {
            events.push({ type: uinput_1.EV_KEY, code: keycodes_1.KEY.LEFTSHIFT, value: 0 });
            this._shiftHeld = false;
            this._shiftOwnedByChar = false;
        }
        this._keyboard.emit(events);
    }
    async typeText(text) {
        this._ensureLive();
        let pending = '';
        const flushPending = async () => {
            if (!pending)
                return;
            const chunk = pending;
            pending = '';
            await this._emitText(chunk);
        };
        for (const ch of text) {
            const stroke = (0, keycodes_1.resolveKeyStroke)(ch);
            if (!stroke) {
                pending += ch;
                continue;
            }
            await flushPending();
            const needShift = !!(stroke.shift && !this._shiftHeld);
            const down = [];
            if (needShift)
                down.push({ type: uinput_1.EV_KEY, code: keycodes_1.KEY.LEFTSHIFT, value: 1 });
            down.push({ type: uinput_1.EV_KEY, code: stroke.code, value: 1 });
            this._keyboard.emit(down);
            const up = [
                { type: uinput_1.EV_KEY, code: stroke.code, value: 0 },
            ];
            if (needShift)
                up.push({ type: uinput_1.EV_KEY, code: keycodes_1.KEY.LEFTSHIFT, value: 0 });
            this._keyboard.emit(up);
        }
        await flushPending();
    }
    async touch(phase, points) {
        this._ensureLive();
        if (phase === 'cancel' || phase === 'end') {
            this._releaseAllTouches();
            if (points.length > 0) {
                this._applyTouchPoints(points);
            }
            return;
        }
        this._applyTouchPoints(points);
    }
    async dispose() {
        if (this._disposed)
            return;
        this._disposed = true;
        try {
            this._releaseAllTouches();
        }
        catch {
            /* */
        }
        this._pointer.destroy();
        this._keyboard.destroy();
        this._touch.destroy();
    }
    async _emitText(text) {
        if (!this._insertText) {
            console.warn('[OsInput] unmapped text (no insertText strategy):', text);
            return;
        }
        await this._insertText(text);
    }
    _pointerAbsMove(x, y) {
        const p = (0, logical_to_device_1.mapLogicalToAbs)(this._transform, x, y);
        const dx = p.x - this._curX;
        const dy = p.y - this._curY;
        if (dx === 0 && dy === 0)
            return;
        this._emitRel(dx, dy);
        this._curX = p.x;
        this._curY = p.y;
    }
    _emitRel(dx, dy) {
        let remainX = dx;
        let remainY = dy;
        while (remainX !== 0 || remainY !== 0) {
            const stepX = remainX === 0 ? 0 : Math.sign(remainX) * Math.min(Math.abs(remainX), REL_CHUNK);
            const stepY = remainY === 0 ? 0 : Math.sign(remainY) * Math.min(Math.abs(remainY), REL_CHUNK);
            remainX -= stepX;
            remainY -= stepY;
            const events = [];
            if (stepX !== 0)
                events.push({ type: uinput_1.EV_REL, code: uinput_1.REL_X, value: stepX });
            if (stepY !== 0)
                events.push({ type: uinput_1.EV_REL, code: uinput_1.REL_Y, value: stepY });
            if (events.length > 0)
                this._pointer.emit(events);
        }
    }
    _applyTouchPoints(points) {
        const seen = new Set();
        const events = [];
        for (const p of points) {
            seen.add(p.id);
        }
        // Release vanished contacts before allocating new slots (same-frame replace).
        for (const [id, slot] of [...this._slotById.entries()]) {
            if (seen.has(id))
                continue;
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_MT_SLOT, value: slot });
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_MT_TRACKING_ID, value: -1 });
            this._slotById.delete(id);
            this._idBySlot.delete(slot);
        }
        for (const p of points) {
            let slot = this._slotById.get(p.id);
            if (slot === undefined) {
                slot = this._allocSlot(p.id);
            }
            const pos = (0, logical_to_device_1.mapLogicalToAbs)(this._transform, p.x, p.y);
            const tracking = (p.id & 0xffff) || 1;
            const pressure = Math.max(1, Math.min(255, Math.round((p.force ?? 0.5) * 255)));
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_MT_SLOT, value: slot });
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_MT_TRACKING_ID, value: tracking });
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_MT_POSITION_X, value: pos.x });
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_MT_POSITION_Y, value: pos.y });
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_MT_PRESSURE, value: pressure });
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_MT_TOUCH_MAJOR, value: Math.max(1, Math.round(pressure / 2)) });
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_X, value: pos.x });
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_Y, value: pos.y });
        }
        events.push({
            type: uinput_1.EV_KEY,
            code: uinput_1.BTN_TOUCH,
            value: this._slotById.size > 0 ? 1 : 0,
        });
        if (events.length > 0)
            this._touch.emit(events);
    }
    _releaseAllTouches() {
        if (this._slotById.size === 0)
            return;
        const events = [];
        for (const [, slot] of this._slotById) {
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_MT_SLOT, value: slot });
            events.push({ type: uinput_1.EV_ABS, code: uinput_1.ABS_MT_TRACKING_ID, value: -1 });
        }
        events.push({ type: uinput_1.EV_KEY, code: uinput_1.BTN_TOUCH, value: 0 });
        this._slotById.clear();
        this._idBySlot.clear();
        this._touch.emit(events);
    }
    _allocSlot(id) {
        for (let s = 0; s < MAX_SLOTS; s++) {
            if (!this._idBySlot.has(s)) {
                this._idBySlot.set(s, id);
                this._slotById.set(id, s);
                return s;
            }
        }
        throw new Error('no free multitouch slots');
    }
    async _awaitDevicesVisible(timeoutMs = ATTACH_TIMEOUT_MS) {
        const deadline = Date.now() + timeoutMs;
        const env = { ...process.env, DISPLAY: this._displayEnv };
        while (Date.now() < deadline) {
            try {
                const { stdout } = await execFileAsync('xinput', ['list', '--name-only'], { env });
                if (stdout.includes(this._pointer.name) &&
                    stdout.includes(this._keyboard.name) &&
                    stdout.includes(this._touch.name)) {
                    return;
                }
            }
            catch {
                /* Xorg may still be coming up */
            }
            await new Promise((r) => setTimeout(r, ATTACH_POLL_MS));
        }
        console.error(`[OsInput] attach failed display=${this._displayEnv} ` +
            `ptr=${this._pointer.name} kbd=${this._keyboard.name} mt=${this._touch.name} session=${this._sessionId}`);
        throw Object.assign(new Error(`uinput devices not visible on ${this._displayEnv} within ${timeoutMs}ms ` +
            `(${this._pointer.name}, ${this._keyboard.name}, ${this._touch.name})`), { code: 'FAILED_PRECONDITION', errorCode: 'uinput_not_attached', phase: 'launch' });
    }
    _ensureLive() {
        if (this._disposed)
            throw new Error('OsInputBackend disposed');
    }
}
exports.OsInputBackend = OsInputBackend;
function mouseBtn(button) {
    if (button === 1)
        return uinput_1.BTN_MIDDLE;
    if (button === 2)
        return uinput_1.BTN_RIGHT;
    return uinput_1.BTN_LEFT;
}
function wheelSteps(delta) {
    if (delta === 0)
        return 0;
    const steps = Math.round(-delta / 100);
    if (steps !== 0)
        return steps;
    return delta < 0 ? 1 : -1;
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
/**
 * Docker does not auto-create /dev/input/eventN for container-born uinput.
 * With device_cgroup_rules c 13:* we mknod from sysfs so Xorg Option "Device" works.
 */
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
            (0, child_process_1.execFileSync)('mknod', [node, 'c', String(major), String(minor)]);
            fs.chmodSync(node, 0o666);
        }
        catch {
            /* host may already own the node */
        }
    }
}
//# sourceMappingURL=OsInputBackend.js.map