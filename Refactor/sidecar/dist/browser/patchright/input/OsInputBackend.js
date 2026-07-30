"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OsInputBackend = void 0;
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
const util_1 = require("util");
const display_isolation_1 = require("./display-isolation");
const keycodes_1 = require("./keycodes");
const logical_to_device_1 = require("./logical-to-device");
const uinput_1 = require("./uinput");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const MAX_SLOTS = 10;
/**
 * Production OS input: dual persistent uinput devices (pointer+kbd, multitouch)
 * bound to the session X display.
 */
class OsInputBackend {
    _pointer;
    _touch;
    _displayEnv;
    _sessionId;
    _insertText;
    _transform;
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
    _registered = false;
    constructor(pointer, touch, displayEnv, sessionId, transform, insertText) {
        this._pointer = pointer;
        this._touch = touch;
        this._displayEnv = displayEnv;
        this._sessionId = sessionId;
        this._transform = transform;
        this._insertText = insertText;
    }
    static async create(opts) {
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
        const pointer = uinput_1.UinputDevice.openPointerKeyboard(`speculum-ptr-${shortId}`, (0, keycodes_1.allKeyboardKeyCodes)(), absMaxX, absMaxY);
        let touch;
        try {
            touch = uinput_1.UinputDevice.openMultitouch(`speculum-mt-${shortId}`, absMaxX, absMaxY, MAX_SLOTS);
        }
        catch (err) {
            pointer.destroy();
            throw err;
        }
        const backend = new OsInputBackend(pointer, touch, opts.displayEnv, opts.sessionId, (0, logical_to_device_1.createCoordTransform)(opts.logicalWidth, opts.logicalHeight, absMaxX, absMaxY), opts.insertText);
        const deviceNames = [pointer.name, touch.name];
        try {
            await (0, display_isolation_1.registerIsolatedInput)({
                sessionId: opts.sessionId,
                displayEnv: opts.displayEnv,
                deviceNames,
            });
            backend._registered = true;
            await backend._awaitDevicesVisible();
            await (0, display_isolation_1.enableNamedDevices)(opts.displayEnv, deviceNames);
        }
        catch (err) {
            await backend.dispose();
            throw err;
        }
        return backend;
    }
    setLogicalSize(logicalWidth, logicalHeight) {
        this._transform = (0, logical_to_device_1.createCoordTransform)(logicalWidth, logicalHeight, this._transform.absMaxX, this._transform.absMaxY);
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
            this._pointer.emit([{ type: uinput_1.EV_KEY, code: keycodes_1.KEY.LEFTSHIFT, value: 1 }]);
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
        this._pointer.emit(events);
    }
    async keyUp(key) {
        this._ensureLive();
        if (key.length === 1 && key.charCodeAt(0) > 127)
            return;
        if (key === 'Shift') {
            this._shiftHeld = false;
            this._shiftOwnedByChar = false;
            this._pointer.emit([{ type: uinput_1.EV_KEY, code: keycodes_1.KEY.LEFTSHIFT, value: 0 }]);
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
        this._pointer.emit(events);
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
            this._pointer.emit(down);
            const up = [
                { type: uinput_1.EV_KEY, code: stroke.code, value: 0 },
            ];
            if (needShift)
                up.push({ type: uinput_1.EV_KEY, code: keycodes_1.KEY.LEFTSHIFT, value: 0 });
            this._pointer.emit(up);
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
        if (this._registered) {
            this._registered = false;
            try {
                await (0, display_isolation_1.unregisterIsolatedInput)(this._sessionId);
            }
            catch {
                /* */
            }
        }
        try {
            this._releaseAllTouches();
        }
        catch {
            /* */
        }
        this._pointer.destroy();
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
        this._pointer.emit([
            { type: uinput_1.EV_ABS, code: uinput_1.ABS_X, value: p.x },
            { type: uinput_1.EV_ABS, code: uinput_1.ABS_Y, value: p.y },
        ]);
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
    async _awaitDevicesVisible(timeoutMs = 5_000) {
        const deadline = Date.now() + timeoutMs;
        const env = { ...process.env, DISPLAY: this._displayEnv };
        let nudged = false;
        while (Date.now() < deadline) {
            if (!nudged) {
                nudged = true;
                await nudgeInputHotplug();
            }
            try {
                const { stdout } = await execFileAsync('xinput', ['list'], { env });
                if (stdout.includes(this._pointer.name) && stdout.includes(this._touch.name)) {
                    return;
                }
            }
            catch {
                /* xinput may not be ready yet */
            }
            await new Promise((r) => setTimeout(r, 50));
        }
        throw Object.assign(new Error(`uinput devices not visible on ${this._displayEnv} within ${timeoutMs}ms ` +
            `(${this._pointer.name}, ${this._touch.name})`), { code: 'FAILED_PRECONDITION', errorCode: 'uinput_not_attached', phase: 'launch' });
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
/** Best-effort: wake container/host udev so Xorg AutoAddDevices sees new uinput nodes. */
async function nudgeInputHotplug() {
    try {
        await execFileAsync('udevadm', ['trigger', '--subsystem-match=input', '--action=add']);
        await execFileAsync('udevadm', ['settle', '--timeout=2']);
    }
    catch {
        /* udev optional when /run/udev is mounted from the host */
    }
}
//# sourceMappingURL=OsInputBackend.js.map