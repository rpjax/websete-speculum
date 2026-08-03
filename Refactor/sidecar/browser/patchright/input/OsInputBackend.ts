import { createHash } from 'crypto';
import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';
import type { BrowserTouchPoint } from '../../BrowserSession';
import type { InputBackend } from './InputBackend';
import { allKeyboardKeyCodes, KEY, resolveKeyStroke } from './keycodes';
import {
  createLogicalWindowTransform,
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
  REL_X,
  REL_Y,
  UinputDevice,
  uinputAvailable,
} from './uinput';

const execFileAsync = promisify(execFile);

const MAX_SLOTS = 10;
/** Xorg already binds our InputDevice sections — assert should be near-instant. */
const ATTACH_TIMEOUT_MS = 3_000;
const ATTACH_POLL_MS = 10;
/** Evdev relative deltas are typically int8/int16-safe; chunk large warps. */
const REL_CHUNK = 127;

export type OsInputBackendOpenOptions = {
  sessionId: string;
  displayWidth: number;
  displayHeight: number;
  logicalWidth: number;
  logicalHeight: number;
};

export type OsInputBackendOptions = OsInputBackendOpenOptions & {
  displayEnv: string;
  /**
   * Text-entry escape for characters with no EV_KEY mapping (e.g. ã).
   * Pointer/touch/ASCII keys stay on uinput — never used as a general CDP fallback.
   */
  insertText?: (text: string) => Promise<void>;
};

/**
 * Production OS input: dual persistent uinput devices (pointer+kbd, multitouch)
 * bound into the session Xorg via explicit InputDevice sections.
 *
 * Open kernel nodes *before* Display.start, then attach asserts xinput visibility.
 */
export class OsInputBackend implements InputBackend {
  private readonly _pointer: UinputDevice;
  private readonly _keyboard: UinputDevice;
  private readonly _touch: UinputDevice;
  private _displayEnv: string;
  private readonly _sessionId: string;
  private _insertText?: (text: string) => Promise<void>;
  private _transform: CoordTransform;
  /** Display capacity for relative-pointer home reset (window may be smaller). */
  private readonly _displayAbsMaxX: number;
  private readonly _displayAbsMaxY: number;
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
  private _attached = false;
  /** Software cursor in display ABS space — relative mouse needs a known origin. */
  private _curX = 0;
  private _curY = 0;

  private constructor(
    pointer: UinputDevice,
    keyboard: UinputDevice,
    touch: UinputDevice,
    displayEnv: string,
    sessionId: string,
    transform: CoordTransform,
    displayAbsMaxX: number,
    displayAbsMaxY: number,
    insertText?: (text: string) => Promise<void>,
  ) {
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

  get deviceNames(): readonly string[] {
    return [this._pointer.name, this._keyboard.name, this._touch.name];
  }

  /** Resolve /dev/input/eventN paths for xorg.conf InputDevice sections. */
  resolveEventPaths(): {
    pointerEventPath: string;
    keyboardEventPath: string;
    touchEventPath: string;
  } {
    ensureInputEventNodes(this._pointer.name, this._keyboard.name, this._touch.name);
    const handlers = listInputHandlers(this._pointer.name, this._keyboard.name, this._touch.name);
    const ptr = handlers.find((h) => h.name === this._pointer.name);
    const kbd = handlers.find((h) => h.name === this._keyboard.name);
    const mt = handlers.find((h) => h.name === this._touch.name);
    if (!ptr || !kbd || !mt) {
      throw Object.assign(
        new Error(
          `uinput event nodes missing after create (${this._pointer.name}, ${this._keyboard.name}, ${this._touch.name})`,
        ),
        { code: 'FAILED_PRECONDITION', errorCode: 'uinput_event_missing', phase: 'launch' },
      );
    }
    return {
      pointerEventPath: `/dev/input/${ptr.event}`,
      keyboardEventPath: `/dev/input/${kbd.event}`,
      touchEventPath: `/dev/input/${mt.event}`,
    };
  }

  /** Create kernel uinput nodes + /dev/input event nodes — call before Display.start. */
  static async open(opts: OsInputBackendOpenOptions): Promise<OsInputBackend> {
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
    const pointer = UinputDevice.openPointer(`speculum-ptr-${shortId}`);
    let keyboard: UinputDevice;
    try {
      keyboard = UinputDevice.openKeyboard(`speculum-kbd-${shortId}`, allKeyboardKeyCodes());
    } catch (err) {
      pointer.destroy();
      throw err;
    }
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
      keyboard.destroy();
      throw err;
    }

    const backend = new OsInputBackend(
      pointer,
      keyboard,
      touch,
      '',
      opts.sessionId,
      createLogicalWindowTransform(opts.logicalWidth, opts.logicalHeight),
      absMaxX,
      absMaxY,
    );
    ensureInputEventNodes(pointer.name, keyboard.name, touch.name);
    return backend;
  }

  setInsertText(insertText: (text: string) => Promise<void>): void {
    this._insertText = insertText;
  }

  /** After Display.start: assert our InputDevice identifiers appear on this DISPLAY. */
  async attachToDisplay(displayEnv: string): Promise<void> {
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
    } catch (err) {
      await this.dispose();
      throw err;
    }
  }

  static async create(opts: OsInputBackendOptions): Promise<OsInputBackend> {
    const backend = await OsInputBackend.open(opts);
    if (opts.insertText) backend.setInsertText(opts.insertText);
    await backend.attachToDisplay(opts.displayEnv);
    return backend;
  }

  setLogicalSize(logicalWidth: number, logicalHeight: number): void {
    this._transform = createLogicalWindowTransform(logicalWidth, logicalHeight);
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
      this._keyboard.emit([{ type: EV_KEY, code: KEY.LEFTSHIFT, value: 1 }]);
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
    this._keyboard.emit(events);
  }

  async keyUp(key: string): Promise<void> {
    this._ensureLive();
    if (key.length === 1 && key.charCodeAt(0) > 127) return;
    if (key === 'Shift') {
      this._shiftHeld = false;
      this._shiftOwnedByChar = false;
      this._keyboard.emit([{ type: EV_KEY, code: KEY.LEFTSHIFT, value: 0 }]);
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
    this._keyboard.emit(events);
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
      this._keyboard.emit(down);
      const up: Array<{ type: number; code: number; value: number }> = [
        { type: EV_KEY, code: stroke.code, value: 0 },
      ];
      if (needShift) up.push({ type: EV_KEY, code: KEY.LEFTSHIFT, value: 0 });
      this._keyboard.emit(up);
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
    try {
      this._releaseAllTouches();
    } catch {
      /* */
    }
    this._pointer.destroy();
    this._keyboard.destroy();
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
    const dx = p.x - this._curX;
    const dy = p.y - this._curY;
    if (dx === 0 && dy === 0) return;
    this._emitRel(dx, dy);
    this._curX = p.x;
    this._curY = p.y;
  }

  private _emitRel(dx: number, dy: number): void {
    let remainX = dx;
    let remainY = dy;
    while (remainX !== 0 || remainY !== 0) {
      const stepX =
        remainX === 0 ? 0 : Math.sign(remainX) * Math.min(Math.abs(remainX), REL_CHUNK);
      const stepY =
        remainY === 0 ? 0 : Math.sign(remainY) * Math.min(Math.abs(remainY), REL_CHUNK);
      remainX -= stepX;
      remainY -= stepY;
      const events: Array<{ type: number; code: number; value: number }> = [];
      if (stepX !== 0) events.push({ type: EV_REL, code: REL_X, value: stepX });
      if (stepY !== 0) events.push({ type: EV_REL, code: REL_Y, value: stepY });
      if (events.length > 0) this._pointer.emit(events);
    }
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

  private async _awaitDevicesVisible(timeoutMs = ATTACH_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const env = { ...process.env as Record<string, string>, DISPLAY: this._displayEnv };
    while (Date.now() < deadline) {
      try {
        const { stdout } = await execFileAsync('xinput', ['list', '--name-only'], { env });
        if (
          stdout.includes(this._pointer.name) &&
          stdout.includes(this._keyboard.name) &&
          stdout.includes(this._touch.name)
        ) {
          return;
        }
      } catch {
        /* Xorg may still be coming up */
      }
      await new Promise<void>((r) => setTimeout(r, ATTACH_POLL_MS));
    }
    console.error(
      `[OsInput] attach failed display=${this._displayEnv} ` +
        `ptr=${this._pointer.name} kbd=${this._keyboard.name} mt=${this._touch.name} session=${this._sessionId}`,
    );
    throw Object.assign(
      new Error(
        `uinput devices not visible on ${this._displayEnv} within ${timeoutMs}ms ` +
          `(${this._pointer.name}, ${this._keyboard.name}, ${this._touch.name})`,
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

type InputHandlerRef = { name: string; event: string };

function listInputHandlers(...deviceNames: string[]): InputHandlerRef[] {
  const wanted = new Set(deviceNames.filter((n) => n.length > 0));
  if (wanted.size === 0) return [];
  let text: string;
  try {
    text = fs.readFileSync('/proc/bus/input/devices', 'utf8');
  } catch {
    return [];
  }
  const out: InputHandlerRef[] = [];
  for (const block of text.split('\n\n')) {
    const nameMatch = block.match(/^N: Name="([^"]+)"/m);
    const handlersMatch = block.match(/^H: Handlers=([^\n]+)/m);
    if (!nameMatch || !handlersMatch) continue;
    if (!wanted.has(nameMatch[1]!)) continue;
    for (const token of handlersMatch[1]!.trim().split(/\s+/)) {
      if (!/^event\d+$/.test(token)) continue;
      out.push({ name: nameMatch[1]!, event: token });
    }
  }
  return out;
}

/**
 * Docker does not auto-create /dev/input/eventN for container-born uinput.
 * With device_cgroup_rules c 13:* we mknod from sysfs so Xorg Option "Device" works.
 */
function ensureInputEventNodes(...deviceNames: string[]): void {
  try {
    fs.mkdirSync('/dev/input', { recursive: true });
  } catch {
    /* */
  }
  for (const { event } of listInputHandlers(...deviceNames)) {
    const node = `/dev/input/${event}`;
    if (fs.existsSync(node)) continue;
    let majMin: string;
    try {
      majMin = fs.readFileSync(`/sys/class/input/${event}/dev`, 'utf8').trim();
    } catch {
      continue;
    }
    const [majS, minS] = majMin.split(':');
    const major = Number(majS);
    const minor = Number(minS);
    if (!Number.isInteger(major) || !Number.isInteger(minor)) continue;
    try {
      execFileSync('mknod', [node, 'c', String(major), String(minor)]);
      fs.chmodSync(node, 0o666);
    } catch {
      /* host may already own the node */
    }
  }
}
