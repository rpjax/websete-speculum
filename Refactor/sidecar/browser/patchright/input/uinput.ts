import * as fs from 'fs';
import koffi from 'koffi';

/** Linux input / uinput constants (x86_64 / aarch64 common values). */
export const EV_SYN = 0x00;
export const EV_KEY = 0x01;
export const EV_REL = 0x02;
export const EV_ABS = 0x03;
export const SYN_REPORT = 0;

export const BTN_LEFT = 0x110;
export const BTN_RIGHT = 0x111;
export const BTN_MIDDLE = 0x112;
export const BTN_TOOL_PEN = 0x140;
export const BTN_TOUCH = 0x14a;

export const REL_X = 0x00;
export const REL_Y = 0x01;
export const REL_WHEEL = 0x08;
export const REL_HWHEEL = 0x06;

export const ABS_X = 0x00;
export const ABS_Y = 0x01;
export const ABS_MT_SLOT = 0x2f;
export const ABS_MT_TOUCH_MAJOR = 0x30;
export const ABS_MT_POSITION_X = 0x35;
export const ABS_MT_POSITION_Y = 0x36;
export const ABS_MT_TRACKING_ID = 0x39;
export const ABS_MT_PRESSURE = 0x3a;

export const INPUT_PROP_POINTER = 0x00;
export const INPUT_PROP_DIRECT = 0x01;

const ABS_CNT = 0x40;
const UINPUT_MAX_NAME_SIZE = 80;

// ioctl request numbers for 'U' (uinput) — Linux _IO / _IOW('U', n, int)
const UI_DEV_CREATE = 0x5501;
const UI_DEV_DESTROY = 0x5502;
const UI_SET_EVBIT = 0x40045564;
const UI_SET_KEYBIT = 0x40045565;
const UI_SET_RELBIT = 0x40045566;
const UI_SET_ABSBIT = 0x40045567;
const UI_SET_PROPBIT = 0x4004556e;

const EVENT_SIZE = 24; // timeval(16) + type(2) + code(2) + value(4) on 64-bit Linux
const UDEV_SIZE = 80 + 8 + 4 + ABS_CNT * 4 * 4; // name + id + ff + absmax/min/fuzz/flat

let ioctlFn: ((fd: number, request: number, arg: number) => number) | null = null;

/**
 * UI_SET_* take an int; UI_DEV_CREATE/DESTROY ignore the third arg.
 * Use a fixed 3-arg prototype — koffi's variadic `...` form requires
 * alternating type/value pairs (`ioctl(fd, req, 'int', arg)`). Calling
 * `ioctl(fd, req, arg)` throws "Missing value argument for variadic call"
 * and aborts StartSession.
 */
function ioctl(fd: number, request: number, arg: number): void {
  if (!ioctlFn) {
    const libc = koffi.load('libc.so.6');
    ioctlFn = libc.func('int ioctl(int fd, unsigned long request, int arg)');
  }
  const rc = ioctlFn(fd, request, arg);
  if (rc < 0) {
    throw new Error(`ioctl(0x${request.toString(16)}, ${arg}) failed`);
  }
}

function writeSync(fd: number, buf: Buffer): void {
  const n = fs.writeSync(fd, buf);
  if (n !== buf.length) {
    throw new Error(`short write to uinput (${n}/${buf.length})`);
  }
}

function packEvent(type: number, code: number, value: number, out: Buffer, offset: number): void {
  // timeval zeroed — kernel fills timestamps
  out.writeBigUInt64LE(0n, offset);
  out.writeBigUInt64LE(0n, offset + 8);
  out.writeUInt16LE(type, offset + 16);
  out.writeUInt16LE(code, offset + 18);
  out.writeInt32LE(value, offset + 20);
}

function openUinputFd(): number {
  // Must NOT use fs flag 'w' (O_CREAT|O_TRUNC) on a device node.
  return fs.openSync('/dev/uinput', fs.constants.O_RDWR);
}

export class UinputDevice {
  readonly fd: number;
  readonly name: string;
  private readonly _eventBuf = Buffer.allocUnsafe(EVENT_SIZE * 32);
  private _disposed = false;

  private constructor(fd: number, name: string) {
    this.fd = fd;
    this.name = name;
  }

  static openPointer(name: string): UinputDevice {
    const fd = openUinputFd();
    try {
      ioctl(fd, UI_SET_EVBIT, EV_KEY);
      ioctl(fd, UI_SET_EVBIT, EV_REL);
      ioctl(fd, UI_SET_EVBIT, EV_SYN);
      ioctl(fd, UI_SET_KEYBIT, BTN_LEFT);
      ioctl(fd, UI_SET_KEYBIT, BTN_RIGHT);
      ioctl(fd, UI_SET_KEYBIT, BTN_MIDDLE);
      // Relative mouse only. Absolute ABS under xf86-input-evdev often fails to
      // deliver core pointer clicks to Chrome. Keyboard is a separate uinput
      // device (openKeyboard) so X can bind a real CoreKeyboard.
      ioctl(fd, UI_SET_RELBIT, REL_X);
      ioctl(fd, UI_SET_RELBIT, REL_Y);
      ioctl(fd, UI_SET_RELBIT, REL_WHEEL);
      ioctl(fd, UI_SET_RELBIT, REL_HWHEEL);
      try {
        ioctl(fd, UI_SET_PROPBIT, INPUT_PROP_POINTER);
      } catch {
        /* optional */
      }
      writeUserDev(fd, name, /*bustype*/ 0x03, /*vendor*/ 0x0001, /*product*/ 0x0001);
      ioctl(fd, UI_DEV_CREATE, 0);
      return new UinputDevice(fd, name);
    } catch (err) {
      try {
        fs.closeSync(fd);
      } catch {
        /* */
      }
      throw err;
    }
  }

  static openKeyboard(name: string, keyCodes: readonly number[]): UinputDevice {
    const fd = openUinputFd();
    try {
      ioctl(fd, UI_SET_EVBIT, EV_KEY);
      ioctl(fd, UI_SET_EVBIT, EV_SYN);
      for (const code of keyCodes) {
        ioctl(fd, UI_SET_KEYBIT, code);
      }
      writeUserDev(fd, name, /*bustype*/ 0x03, /*vendor*/ 0x0001, /*product*/ 0x0003);
      ioctl(fd, UI_DEV_CREATE, 0);
      return new UinputDevice(fd, name);
    } catch (err) {
      try {
        fs.closeSync(fd);
      } catch {
        /* */
      }
      throw err;
    }
  }

  static openMultitouch(
    name: string,
    absMaxX: number,
    absMaxY: number,
    maxSlots: number,
  ): UinputDevice {
    const fd = openUinputFd();
    try {
      ioctl(fd, UI_SET_EVBIT, EV_KEY);
      ioctl(fd, UI_SET_EVBIT, EV_ABS);
      ioctl(fd, UI_SET_EVBIT, EV_SYN);
      ioctl(fd, UI_SET_KEYBIT, BTN_TOUCH);
      ioctl(fd, UI_SET_ABSBIT, ABS_X);
      ioctl(fd, UI_SET_ABSBIT, ABS_Y);
      ioctl(fd, UI_SET_ABSBIT, ABS_MT_SLOT);
      ioctl(fd, UI_SET_ABSBIT, ABS_MT_TRACKING_ID);
      ioctl(fd, UI_SET_ABSBIT, ABS_MT_POSITION_X);
      ioctl(fd, UI_SET_ABSBIT, ABS_MT_POSITION_Y);
      ioctl(fd, UI_SET_ABSBIT, ABS_MT_PRESSURE);
      ioctl(fd, UI_SET_ABSBIT, ABS_MT_TOUCH_MAJOR);
      try {
        ioctl(fd, UI_SET_PROPBIT, INPUT_PROP_DIRECT);
      } catch {
        /* optional on older kernels */
      }

      const absmax = new Int32Array(ABS_CNT);
      const absmin = new Int32Array(ABS_CNT);
      absmax[ABS_X] = absMaxX;
      absmax[ABS_Y] = absMaxY;
      absmax[ABS_MT_SLOT] = Math.max(0, maxSlots - 1);
      absmax[ABS_MT_TRACKING_ID] = 65535;
      absmax[ABS_MT_POSITION_X] = absMaxX;
      absmax[ABS_MT_POSITION_Y] = absMaxY;
      absmax[ABS_MT_PRESSURE] = 255;
      absmax[ABS_MT_TOUCH_MAJOR] = 255;

      writeUserDev(
        fd,
        name,
        /*bustype*/ 0x03,
        /*vendor*/ 0x0001,
        /*product*/ 0x0002,
        absmin,
        absmax,
      );
      ioctl(fd, UI_DEV_CREATE, 0);
      return new UinputDevice(fd, name);
    } catch (err) {
      try {
        fs.closeSync(fd);
      } catch {
        /* */
      }
      throw err;
    }
  }

  /** Emit one or more events followed by SYN_REPORT. */
  emit(events: Array<{ type: number; code: number; value: number }>): void {
    if (this._disposed) throw new Error('uinput device disposed');
    const need = (events.length + 1) * EVENT_SIZE;
    const buf = need <= this._eventBuf.length ? this._eventBuf : Buffer.allocUnsafe(need);
    let off = 0;
    for (const e of events) {
      packEvent(e.type, e.code, e.value, buf, off);
      off += EVENT_SIZE;
    }
    packEvent(EV_SYN, SYN_REPORT, 0, buf, off);
    off += EVENT_SIZE;
    writeSync(this.fd, buf.subarray(0, off));
  }

  destroy(): void {
    if (this._disposed) return;
    this._disposed = true;
    try {
      ioctl(this.fd, UI_DEV_DESTROY, 0);
    } catch {
      /* best-effort */
    }
    try {
      fs.closeSync(this.fd);
    } catch {
      /* */
    }
  }
}

function writeUserDev(
  fd: number,
  name: string,
  bustype: number,
  vendor: number,
  product: number,
  absmin?: Int32Array,
  absmax?: Int32Array,
): void {
  const buf = Buffer.alloc(UDEV_SIZE, 0);
  const nameBytes = Buffer.from(name.slice(0, UINPUT_MAX_NAME_SIZE - 1), 'utf8');
  nameBytes.copy(buf, 0);
  // struct input_id at offset 80: bustype, vendor, product, version (u16 each)
  buf.writeUInt16LE(bustype, 80);
  buf.writeUInt16LE(vendor, 82);
  buf.writeUInt16LE(product, 84);
  buf.writeUInt16LE(1, 86);
  // ff_effects_max at 88
  buf.writeInt32LE(0, 88);
  const absBase = 92;
  // struct order: absmax[ABS_CNT], absmin[ABS_CNT], absfuzz, absflat
  if (absmax) {
    for (let i = 0; i < ABS_CNT; i++) {
      buf.writeInt32LE(absmax[i] ?? 0, absBase + i * 4);
    }
  }
  if (absmin) {
    const minBase = absBase + ABS_CNT * 4;
    for (let i = 0; i < ABS_CNT; i++) {
      buf.writeInt32LE(absmin[i] ?? 0, minBase + i * 4);
    }
  }
  writeSync(fd, buf);
}

export function uinputAvailable(): boolean {
  try {
    // access(2) can succeed on a dead mknod; open is the real usability gate.
    const fd = fs.openSync('/dev/uinput', fs.constants.O_RDWR);
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}
