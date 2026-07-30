import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { BrowserTouchPoint } from '../../BrowserSession';
import type { InputBackend } from './InputBackend';
import { registerIsolatedInput, unregisterIsolatedInput, enableNamedDevices } from './display-isolation';
import { allKeyboardKeyCodes, KEY, resolveKeyStroke } from './keycodes';
import {
  createCoordTransform,
  mapLogicalToAbs,
  type CoordTransform,
} from './logical-to-device';
import {
  ABS_MT_POSITION_X,
  ABS_MT_POSITION_Y,
  ABS_MT_PRESSURE,
  ABS_MT_SLOT,
  ABS_MT_TOUCH_MAJOR,
  ABS_MT_TRACKING_ID,
  ABS_X,
  ABS_Y,
  BTN_LEFT,
  BTN_MIDDLE,
  BTN_RIGHT,
  BTN_TOUCH,
  EV_ABS,
  EV_KEY,
  EV_REL,
  REL_HWHEEL,
  REL_WHEEL,
  UinputDevice,
  uinputAvailable,
} from './uinput';

const execFileAsync = promisify(execFile);

const MAX_SLOTS = 10;

export type OsInputBackendOptions = {
  sessionId: string;
  displayEnv: string;
  displayWidth: number;
  displayHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  /**
   * Text-entry escape for characters with no EV_KEY mapping (e.g. ã).
   * Pointer/touch/ASCII keys stay on uinput — never used as a general CDP fallback.
   */
  insertText?: (text: string) => Promise<void>;
};

/**
 * Production OS input: dual persistent uinput devices (pointer+kbd, multitouch)
 * bound to the session X display.
 */
export class OsInputBackend implements InputBackend {
  private readonly _pointer: UinputDevice;
  private readonly _touch: UinputDevice;
  private readonly _displayEnv: string;
  private readonly _sessionId: string;
  private readonly _insertText?: (text: string) => Promise<void>;
  private _transform: CoordTransform;
  private readonly _slotById = new Map<number, number>();
  private readonly _idBySlot = new Map<number, number>();
  /** Explicit Shift key from the client (keydown Shift) — sticky until keyup Shift. */
  private _shiftHeld = false;
  /**
   * Shift we raised ourselves for a shifted char (e.g. '!') when the client did
   * not send a separate Shift keydown — released on matching keyUp.
   */
  private _shiftOwnedByChar = false;
  private _disposed = false;
  private _registered = false;

  private constructor(
    pointer: UinputDevice,
    touch: UinputDevice,
    displayEnv: string,
    sessionId: string,
    transform: CoordTransform,
    insertText?: (text: string) => Promise<void>,
  ) {
    this._pointer = pointer;
    this._touch = touch;
    this._displayEnv = displayEnv;
    this._sessionId = sessionId;
    this._transform = transform;
    this._insertText = insertText;
  }

  static async create(opts: OsInputBackendOptions): Promise<OsInputBackend> {
    if (!uinputAvailable()) {
      throw Object.assign(new Error('/dev/uinput is not available'), {
        code: 'FAILED_PRECONDITION',
        errorCode: 'uinput_unavailable',
        phase: 'launch',
      });
    }
    const absMaxX = Math.max(0, opts.displayWidth - 1);
    const absMaxY = Math.max(0, opts.displayHeight - 1);
    const shortId = createHash('sha1').update(opts.sessionId).digest('hex').slice(0, 12);
    const pointer = UinputDevice.openPointerKeyboard(
      `speculum-ptr-${shortId}`,
      allKeyboardKeyCodes(),
      absMaxX,
      absMaxY,
    );
    let touch: UinputDevice;
    try {
      touch = UinputDevice.openMultitouch(
        `speculum-mt-${shortId}`,
        absMaxX,
        absMaxY,
        MAX_SLOTS,
      );
    } catch (err) {
      pointer.destroy();
      throw err;
    }

    const backend = new OsInputBackend(
      pointer,
      touch,
      opts.displayEnv,
      opts.sessionId,
      createCoordTransform(opts.logicalWidth, opts.logicalHeight, absMaxX, absMaxY),
      opts.insertText,
    );

    const deviceNames = [pointer.name, touch.name];
    try {
      await registerIsolatedInput({
        sessionId: opts.sessionId,
        displayEnv: opts.displayEnv,
        deviceNames,
      });
      backend._registered = true;
      await backend._awaitDevicesVisible();
      await enableNamedDevices(opts.displayEnv, deviceNames);
    } catch (err) {
      await backend.dispose();
      throw err;
    }
    return backend;
  }

  setLogicalSize(logicalWidth: number, logicalHeight: number): void {
    this._transform = createCoordTransform(
      logicalWidth,
      logicalHeight,
      this._transform.absMaxX,
      this._transform.absMaxY,
    );
  }

  async move(x: number, y: number): Promise<void> {
    this._ensureLive();
    this._pointerAbsMove(x, y);
  }

  async down(button: number, x: number, y: number): Promise<void> {
    this._ensureLive();
    this._pointerAbsMove(x, y);
    this._pointer.emit([{ type: EV_KEY, code: mouseBtn(button), value: 1 }]);
  }

  async up(button: number, x: number, y: number): Promise<void> {
    this._ensureLive();
    this._pointerAbsMove(x, y);
    this._pointer.emit([{ type: EV_KEY, code: mouseBtn(button), value: 0 }]);
  }

  async wheel(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    this._ensureLive();
    this._pointerAbsMove(x, y);
    const events: Array<{ type: number; code: number; value: number }> = [];
    const stepsY = wheelSteps(deltaY);
    if (stepsY !== 0) events.push({ type: EV_REL, code: REL_WHEEL, value: stepsY });
    const stepsX = wheelSteps(deltaX);
    if (stepsX !== 0) events.push({ type: EV_REL, code: REL_HWHEEL, value: stepsX });
    if (events.length === 0) return;
    this._pointer.emit(events);
  }

  async keyDown(key: string): Promise<void> {
    this._ensureLive();
    if (key.length === 1 && key.charCodeAt(0) > 127) {
      await this._emitText(key);
      return;
    }
    if (key === 'Shift') {
      this._shiftHeld = true;
      this._shiftOwnedByChar = false;
      this._pointer.emit([{ type: EV_KEY, code: KEY.LEFTSHIFT, value: 1 }]);
      return;
    }
    const stroke = resolveKeyStroke(key);
    if (!stroke) {
      console.warn('[OsInput] unsupported keyDown:', key);
      return;
    }
    const events: Array<{ type: number; code: number; value: number }> = [];
    // Client sends Shift as its own keydown; do not double-press when already held.
    // Only synthesize shift for shifted glyphs ('!', 'A') when Shift was not sent.
    if (stroke.shift && !this._shiftHeld) {
      events.push({ type: EV_KEY, code: KEY.LEFTSHIFT, value: 1 });
      this._shiftHeld = true;
      this._shiftOwnedByChar = true;
    }
    events.push({ type: EV_KEY, code: stroke.code, value: 1 });
    this._pointer.emit(events);
  }

  async keyUp(key: string): Promise<void> {
    this._ensureLive();
    if (key.length === 1 && key.charCodeAt(0) > 127) return;
    if (key === 'Shift') {
      this._shiftHeld = false;
      this._shiftOwnedByChar = false;
      this._pointer.emit([{ type: EV_KEY, code: KEY.LEFTSHIFT, value: 0 }]);
      return;
    }
    const stroke = resolveKeyStroke(key);
    if (!stroke) return;
    const events: Array<{ type: number; code: number; value: number }> = [
      { type: EV_KEY, code: stroke.code, value: 0 },
    ];
    // Never release sticky client Shift on keyUp('A') — only release shift we owned.
    if (stroke.shift && this._shiftOwnedByChar) {
      events.push({ type: EV_KEY, code: KEY.LEFTSHIFT, value: 0 });
      this._shiftHeld = false;
      this._shiftOwnedByChar = false;
    }
    this._pointer.emit(events);
  }

  async typeText(text: string): Promise<void> {
    this._ensureLive();
    let pending = '';
    const flushPending = async () => {
      if (!pending) return;
      const chunk = pending;
      pending = '';
      await this._emitText(chunk);
    };
    for (const ch of text) {
      const stroke = resolveKeyStroke(ch);
      if (!stroke) {
        pending += ch;
        continue;
      }
      await flushPending();
      const needShift = !!(stroke.shift && !this._shiftHeld);
      const down: Array<{ type: number; code: number; value: number }> = [];
      if (needShift) down.push({ type: EV_KEY, code: KEY.LEFTSHIFT, value: 1 });
      down.push({ type: EV_KEY, code: stroke.code, value: 1 });
      this._pointer.emit(down);
      const up: Array<{ type: number; code: number; value: number }> = [
        { type: EV_KEY, code: stroke.code, value: 0 },
      ];
      if (needShift) up.push({ type: EV_KEY, code: KEY.LEFTSHIFT, value: 0 });
      this._pointer.emit(up);
    }
    await flushPending();
  }

  async touch(phase: string, points: readonly BrowserTouchPoint[]): Promise<void> {
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

  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    if (this._registered) {
      this._registered = false;
      try {
        await unregisterIsolatedInput(this._sessionId);
      } catch {
        /* */
      }
    }
    try {
      this._releaseAllTouches();
    } catch {
      /* */
    }
    this._pointer.destroy();
    this._touch.destroy();
  }

  private async _emitText(text: string): Promise<void> {
    if (!this._insertText) {
      console.warn('[OsInput] unmapped text (no insertText strategy):', text);
      return;
    }
    await this._insertText(text);
  }

  private _pointerAbsMove(x: number, y: number): void {
    const p = mapLogicalToAbs(this._transform, x, y);
    this._pointer.emit([
      { type: EV_ABS, code: ABS_X, value: p.x },
      { type: EV_ABS, code: ABS_Y, value: p.y },
    ]);
  }

  private _applyTouchPoints(points: readonly BrowserTouchPoint[]): void {
    const seen = new Set<number>();
    const events: Array<{ type: number; code: number; value: number }> = [];
    for (const p of points) {
      seen.add(p.id);
    }
    // Release vanished contacts before allocating new slots (same-frame replace).
    for (const [id, slot] of [...this._slotById.entries()]) {
      if (seen.has(id)) continue;
      events.push({ type: EV_ABS, code: ABS_MT_SLOT, value: slot });
      events.push({ type: EV_ABS, code: ABS_MT_TRACKING_ID, value: -1 });
      this._slotById.delete(id);
      this._idBySlot.delete(slot);
    }
    for (const p of points) {
      let slot = this._slotById.get(p.id);
      if (slot === undefined) {
        slot = this._allocSlot(p.id);
      }
      const pos = mapLogicalToAbs(this._transform, p.x, p.y);
      const tracking = (p.id & 0xffff) || 1;
      const pressure = Math.max(1, Math.min(255, Math.round((p.force ?? 0.5) * 255)));
      events.push({ type: EV_ABS, code: ABS_MT_SLOT, value: slot });
      events.push({ type: EV_ABS, code: ABS_MT_TRACKING_ID, value: tracking });
      events.push({ type: EV_ABS, code: ABS_MT_POSITION_X, value: pos.x });
      events.push({ type: EV_ABS, code: ABS_MT_POSITION_Y, value: pos.y });
      events.push({ type: EV_ABS, code: ABS_MT_PRESSURE, value: pressure });
      events.push({ type: EV_ABS, code: ABS_MT_TOUCH_MAJOR, value: Math.max(1, Math.round(pressure / 2)) });
      events.push({ type: EV_ABS, code: ABS_X, value: pos.x });
      events.push({ type: EV_ABS, code: ABS_Y, value: pos.y });
    }
    events.push({
      type: EV_KEY,
      code: BTN_TOUCH,
      value: this._slotById.size > 0 ? 1 : 0,
    });
    if (events.length > 0) this._touch.emit(events);
  }

  private _releaseAllTouches(): void {
    if (this._slotById.size === 0) return;
    const events: Array<{ type: number; code: number; value: number }> = [];
    for (const [, slot] of this._slotById) {
      events.push({ type: EV_ABS, code: ABS_MT_SLOT, value: slot });
      events.push({ type: EV_ABS, code: ABS_MT_TRACKING_ID, value: -1 });
    }
    events.push({ type: EV_KEY, code: BTN_TOUCH, value: 0 });
    this._slotById.clear();
    this._idBySlot.clear();
    this._touch.emit(events);
  }

  private _allocSlot(id: number): number {
    for (let s = 0; s < MAX_SLOTS; s++) {
      if (!this._idBySlot.has(s)) {
        this._idBySlot.set(s, id);
        this._slotById.set(id, s);
        return s;
      }
    }
    throw new Error('no free multitouch slots');
  }

  private async _awaitDevicesVisible(timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const env = { ...process.env as Record<string, string>, DISPLAY: this._displayEnv };
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
      } catch {
        /* xinput may not be ready yet */
      }
      await new Promise<void>((r) => setTimeout(r, 50));
    }
    throw Object.assign(
      new Error(
        `uinput devices not visible on ${this._displayEnv} within ${timeoutMs}ms ` +
          `(${this._pointer.name}, ${this._touch.name})`,
      ),
      { code: 'FAILED_PRECONDITION', errorCode: 'uinput_not_attached', phase: 'launch' },
    );
  }

  private _ensureLive(): void {
    if (this._disposed) throw new Error('OsInputBackend disposed');
  }
}

function mouseBtn(button: number): number {
  if (button === 1) return BTN_MIDDLE;
  if (button === 2) return BTN_RIGHT;
  return BTN_LEFT;
}

function wheelSteps(delta: number): number {
  if (delta === 0) return 0;
  const steps = Math.round(-delta / 100);
  if (steps !== 0) return steps;
  return delta < 0 ? 1 : -1;
}

/** Best-effort: wake container/host udev so Xorg AutoAddDevices sees new uinput nodes. */
async function nudgeInputHotplug(): Promise<void> {
  try {
    await execFileAsync('udevadm', ['trigger', '--subsystem-match=input', '--action=add']);
    await execFileAsync('udevadm', ['settle', '--timeout=2']);
  } catch {
    /* udev optional when /run/udev is mounted from the host */
  }
}
