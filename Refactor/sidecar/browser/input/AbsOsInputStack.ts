/**
 * ABS uinput stack for unified PP input (D-UI-02 / D-UI-20).
 * Opens ABS pointer + keyboard (+ multitouch stub for Xorg InputDevice list),
 * mknods event nodes, exposes writers for AbsPointerPeripheral / KeyboardPeripheral.
 *
 * Coordinate law (D-UI-04): client CSS (x,y) maps 1:1 into ABS via
 * {@link mapLogicalToAbs} — no chrome-inset calibration.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import type { DisplayInputDevices } from '../patchright/Display';
import {
  ABS_X,
  ABS_Y,
  BTN_LEFT,
  BTN_MIDDLE,
  BTN_RIGHT,
  EV_ABS,
  EV_KEY,
  UinputDevice,
  uinputAvailable,
} from '../patchright/input/uinput';
import {
  createCoordTransform,
  createLogicalWindowTransform,
  mapLogicalToAbs,
  type CoordTransform,
} from '../patchright/input/logical-to-device';
import type { AbsPointerWriter, PointerButton } from './peripherals/AbsPointerPeripheral';
import type { KeyboardWriter } from './peripherals/KeyboardPeripheral';
import { resolveKeyStroke, allKeyboardKeyCodes, KEY } from '../patchright/input/keycodes';

export type AbsOsInputOpenOptions = {
  sessionId: string;
  /** Display capacity R (policy max) — uinput ABS range. */
  displayWidth: number;
  displayHeight: number;
  /** Logical CSS viewport — F(x) domain (D-UI-04/05). Defaults to display when omitted. */
  logicalWidth?: number;
  logicalHeight?: number;
};

export class AbsOsInputStack {
  readonly pointer: UinputDevice;
  readonly keyboard: UinputDevice;
  readonly touch: UinputDevice;
  readonly pointerWriter: AbsPointerWriter;
  readonly keyboardWriter: KeyboardWriter;
  private disposed = false;
  private transform: CoordTransform;

  private constructor(
    pointer: UinputDevice,
    keyboard: UinputDevice,
    touch: UinputDevice,
    transform: CoordTransform,
  ) {
    this.pointer = pointer;
    this.keyboard = keyboard;
    this.touch = touch;
    this.transform = transform;
    this.pointerWriter = {
      writeAbs: (x: number, y: number) => this.writeAbs(x, y),
      writeBtn: (btn: PointerButton, down: boolean) => this.writeBtn(btn, down),
      releaseAll: () => this.releasePointer(),
    };
    this.keyboardWriter = {
      writeKey: (code: string, down: boolean, modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }) =>
        this.writeKey(code, down, modifiers),
      releaseAll: () => {
        /* keys are edge-triggered */
      },
    };
  }

  static open(opts: AbsOsInputOpenOptions): AbsOsInputStack {
    if (!uinputAvailable()) {
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
    const transform =
      logicalW === opts.displayWidth && logicalH === opts.displayHeight
        ? createLogicalWindowTransform(logicalW, logicalH)
        : createCoordTransform(logicalW, logicalH, absMaxX, absMaxY);
    const shortId = createHash('sha1').update(opts.sessionId).digest('hex').slice(0, 12);
    const pointer = UinputDevice.openAbsPointer(
      `speculum-abs-${shortId}`,
      absMaxX,
      absMaxY,
    );
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
        10,
      );
    } catch (err) {
      pointer.destroy();
      keyboard.destroy();
      throw err;
    }
    ensureInputEventNodes(pointer.name, keyboard.name, touch.name);
    return new AbsOsInputStack(pointer, keyboard, touch, transform);
  }

  /** Refresh logical viewport after soft-resize — ABS capacity stays at R. */
  setLogicalSize(logicalWidth: number, logicalHeight: number): void {
    this.transform = createCoordTransform(
      logicalWidth,
      logicalHeight,
      Math.max(0, this.transform.absMaxX),
      Math.max(0, this.transform.absMaxY),
    );
  }

  /** Identity transform used by the pointer writer (tests / diagnostics). */
  getCoordTransform(): CoordTransform {
    return this.transform;
  }

  displayInputDevices(): DisplayInputDevices {
    const handlers = listInputHandlers(this.pointer.name, this.keyboard.name, this.touch.name);
    const ptr = handlers.find((h) => h.name === this.pointer.name);
    const kbd = handlers.find((h) => h.name === this.keyboard.name);
    const mt = handlers.find((h) => h.name === this.touch.name);
    if (!ptr || !kbd || !mt) {
      throw Object.assign(
        new Error(
          `uinput event nodes missing after create (${this.pointer.name}, ${this.keyboard.name}, ${this.touch.name})`,
        ),
        { code: 'FAILED_PRECONDITION', errorCode: 'uinput_event_missing', phase: 'launch' },
      );
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

  private writeAbs(x: number, y: number): void {
    const m = mapLogicalToAbs(this.transform, x, y);
    this.pointer.emit([
      { type: EV_ABS, code: ABS_X, value: m.x },
      { type: EV_ABS, code: ABS_Y, value: m.y },
    ]);
  }

  private writeBtn(btn: PointerButton, down: boolean): void {
    const code = btn === 'middle' ? BTN_MIDDLE : btn === 'right' ? BTN_RIGHT : BTN_LEFT;
    this.pointer.emit([{ type: EV_KEY, code, value: down ? 1 : 0 }]);
  }

  private releasePointer(): void {
    this.pointer.emit([
      { type: EV_KEY, code: BTN_LEFT, value: 0 },
      { type: EV_KEY, code: BTN_RIGHT, value: 0 },
      { type: EV_KEY, code: BTN_MIDDLE, value: 0 },
    ]);
  }

  private writeKey(
    code: string,
    down: boolean,
    modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean },
  ): void {
    const stroke = resolveKeyStroke(code);
    if (!stroke) return;
    const needShift = !!(stroke.shift || modifiers?.shift);
    if (needShift && down) {
      this.keyboard.emit([{ type: EV_KEY, code: KEY.LEFTSHIFT, value: 1 }]);
    }
    this.keyboard.emit([{ type: EV_KEY, code: stroke.code, value: down ? 1 : 0 }]);
    if (needShift && !down) {
      this.keyboard.emit([{ type: EV_KEY, code: KEY.LEFTSHIFT, value: 0 }]);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.releasePointer();
    } catch {
      /* */
    }
    this.pointer.destroy();
    this.keyboard.destroy();
    this.touch.destroy();
  }
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
      /* */
    }
  }
}
