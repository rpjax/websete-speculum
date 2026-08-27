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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UinputDevice = exports.INPUT_PROP_DIRECT = exports.INPUT_PROP_POINTER = exports.ABS_MT_PRESSURE = exports.ABS_MT_TRACKING_ID = exports.ABS_MT_POSITION_Y = exports.ABS_MT_POSITION_X = exports.ABS_MT_TOUCH_MAJOR = exports.ABS_MT_SLOT = exports.ABS_Y = exports.ABS_X = exports.REL_HWHEEL = exports.REL_WHEEL = exports.REL_Y = exports.REL_X = exports.BTN_TOUCH = exports.BTN_TOOL_PEN = exports.BTN_MIDDLE = exports.BTN_RIGHT = exports.BTN_LEFT = exports.SYN_REPORT = exports.EV_ABS = exports.EV_REL = exports.EV_KEY = exports.EV_SYN = void 0;
exports.uinputAvailable = uinputAvailable;
const fs = __importStar(require("fs"));
const koffi_1 = __importDefault(require("koffi"));
/** Linux input / uinput constants (x86_64 / aarch64 common values). */
exports.EV_SYN = 0x00;
exports.EV_KEY = 0x01;
exports.EV_REL = 0x02;
exports.EV_ABS = 0x03;
exports.SYN_REPORT = 0;
exports.BTN_LEFT = 0x110;
exports.BTN_RIGHT = 0x111;
exports.BTN_MIDDLE = 0x112;
exports.BTN_TOOL_PEN = 0x140;
exports.BTN_TOUCH = 0x14a;
exports.REL_X = 0x00;
exports.REL_Y = 0x01;
exports.REL_WHEEL = 0x08;
exports.REL_HWHEEL = 0x06;
exports.ABS_X = 0x00;
exports.ABS_Y = 0x01;
exports.ABS_MT_SLOT = 0x2f;
exports.ABS_MT_TOUCH_MAJOR = 0x30;
exports.ABS_MT_POSITION_X = 0x35;
exports.ABS_MT_POSITION_Y = 0x36;
exports.ABS_MT_TRACKING_ID = 0x39;
exports.ABS_MT_PRESSURE = 0x3a;
exports.INPUT_PROP_POINTER = 0x00;
exports.INPUT_PROP_DIRECT = 0x01;
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
let ioctlFn = null;
/**
 * UI_SET_* take an int; UI_DEV_CREATE/DESTROY ignore the third arg.
 * Use a fixed 3-arg prototype — koffi's variadic `...` form requires
 * alternating type/value pairs (`ioctl(fd, req, 'int', arg)`). Calling
 * `ioctl(fd, req, arg)` throws "Missing value argument for variadic call"
 * and aborts StartSession.
 */
function ioctl(fd, request, arg) {
    if (!ioctlFn) {
        const libc = koffi_1.default.load('libc.so.6');
        ioctlFn = libc.func('int ioctl(int fd, unsigned long request, int arg)');
    }
    const rc = ioctlFn(fd, request, arg);
    if (rc < 0) {
        throw new Error(`ioctl(0x${request.toString(16)}, ${arg}) failed`);
    }
}
function writeSync(fd, buf) {
    const n = fs.writeSync(fd, buf);
    if (n !== buf.length) {
        throw new Error(`short write to uinput (${n}/${buf.length})`);
    }
}
function packEvent(type, code, value, out, offset) {
    // timeval zeroed — kernel fills timestamps
    out.writeBigUInt64LE(0n, offset);
    out.writeBigUInt64LE(0n, offset + 8);
    out.writeUInt16LE(type, offset + 16);
    out.writeUInt16LE(code, offset + 18);
    out.writeInt32LE(value, offset + 20);
}
function openUinputFd() {
    // Must NOT use fs flag 'w' (O_CREAT|O_TRUNC) on a device node.
    return fs.openSync('/dev/uinput', fs.constants.O_RDWR);
}
class UinputDevice {
    fd;
    name;
    _eventBuf = Buffer.allocUnsafe(EVENT_SIZE * 32);
    _disposed = false;
    constructor(fd, name) {
        this.fd = fd;
        this.name = name;
    }
    static openPointer(name) {
        const fd = openUinputFd();
        try {
            ioctl(fd, UI_SET_EVBIT, exports.EV_KEY);
            ioctl(fd, UI_SET_EVBIT, exports.EV_REL);
            ioctl(fd, UI_SET_EVBIT, exports.EV_SYN);
            ioctl(fd, UI_SET_KEYBIT, exports.BTN_LEFT);
            ioctl(fd, UI_SET_KEYBIT, exports.BTN_RIGHT);
            ioctl(fd, UI_SET_KEYBIT, exports.BTN_MIDDLE);
            // Relative mouse only. Absolute ABS under xf86-input-evdev often fails to
            // deliver core pointer clicks to Chrome. Keyboard is a separate uinput
            // device (openKeyboard) so X can bind a real CoreKeyboard.
            // Unified PP path uses {@link openAbsPointer} (D-UI-02 / D-UI-20) instead.
            ioctl(fd, UI_SET_RELBIT, exports.REL_X);
            ioctl(fd, UI_SET_RELBIT, exports.REL_Y);
            ioctl(fd, UI_SET_RELBIT, exports.REL_WHEEL);
            ioctl(fd, UI_SET_RELBIT, exports.REL_HWHEEL);
            try {
                ioctl(fd, UI_SET_PROPBIT, exports.INPUT_PROP_POINTER);
            }
            catch {
                /* optional */
            }
            writeUserDev(fd, name, /*bustype*/ 0x03, /*vendor*/ 0x0001, /*product*/ 0x0001);
            ioctl(fd, UI_DEV_CREATE, 0);
            return new UinputDevice(fd, name);
        }
        catch (err) {
            try {
                fs.closeSync(fd);
            }
            catch {
                /* */
            }
            throw err;
        }
    }
    /**
     * Absolute core pointer (D-UI-02). Range = display R−1. No REL axes.
     * Spike D-UI-20 must PASS before this is the production PP path.
     */
    static openAbsPointer(name, absMaxX, absMaxY) {
        const fd = openUinputFd();
        try {
            ioctl(fd, UI_SET_EVBIT, exports.EV_KEY);
            ioctl(fd, UI_SET_EVBIT, exports.EV_ABS);
            ioctl(fd, UI_SET_EVBIT, exports.EV_SYN);
            ioctl(fd, UI_SET_KEYBIT, exports.BTN_LEFT);
            ioctl(fd, UI_SET_KEYBIT, exports.BTN_RIGHT);
            ioctl(fd, UI_SET_KEYBIT, exports.BTN_MIDDLE);
            ioctl(fd, UI_SET_KEYBIT, exports.BTN_TOOL_PEN);
            ioctl(fd, UI_SET_ABSBIT, exports.ABS_X);
            ioctl(fd, UI_SET_ABSBIT, exports.ABS_Y);
            try {
                ioctl(fd, UI_SET_PROPBIT, exports.INPUT_PROP_POINTER);
            }
            catch {
                /* optional */
            }
            const absmax = new Int32Array(ABS_CNT);
            const absmin = new Int32Array(ABS_CNT);
            absmax[exports.ABS_X] = Math.max(0, absMaxX);
            absmax[exports.ABS_Y] = Math.max(0, absMaxY);
            writeUserDev(fd, name, 
            /*bustype*/ 0x03, 
            /*vendor*/ 0x0001, 
            /*product*/ 0x0010, absmin, absmax);
            ioctl(fd, UI_DEV_CREATE, 0);
            return new UinputDevice(fd, name);
        }
        catch (err) {
            try {
                fs.closeSync(fd);
            }
            catch {
                /* */
            }
            throw err;
        }
    }
    static openKeyboard(name, keyCodes) {
        const fd = openUinputFd();
        try {
            ioctl(fd, UI_SET_EVBIT, exports.EV_KEY);
            ioctl(fd, UI_SET_EVBIT, exports.EV_SYN);
            for (const code of keyCodes) {
                ioctl(fd, UI_SET_KEYBIT, code);
            }
            writeUserDev(fd, name, /*bustype*/ 0x03, /*vendor*/ 0x0001, /*product*/ 0x0003);
            ioctl(fd, UI_DEV_CREATE, 0);
            return new UinputDevice(fd, name);
        }
        catch (err) {
            try {
                fs.closeSync(fd);
            }
            catch {
                /* */
            }
            throw err;
        }
    }
    static openMultitouch(name, absMaxX, absMaxY, maxSlots) {
        const fd = openUinputFd();
        try {
            ioctl(fd, UI_SET_EVBIT, exports.EV_KEY);
            ioctl(fd, UI_SET_EVBIT, exports.EV_ABS);
            ioctl(fd, UI_SET_EVBIT, exports.EV_SYN);
            ioctl(fd, UI_SET_KEYBIT, exports.BTN_TOUCH);
            ioctl(fd, UI_SET_ABSBIT, exports.ABS_X);
            ioctl(fd, UI_SET_ABSBIT, exports.ABS_Y);
            ioctl(fd, UI_SET_ABSBIT, exports.ABS_MT_SLOT);
            ioctl(fd, UI_SET_ABSBIT, exports.ABS_MT_TRACKING_ID);
            ioctl(fd, UI_SET_ABSBIT, exports.ABS_MT_POSITION_X);
            ioctl(fd, UI_SET_ABSBIT, exports.ABS_MT_POSITION_Y);
            ioctl(fd, UI_SET_ABSBIT, exports.ABS_MT_PRESSURE);
            ioctl(fd, UI_SET_ABSBIT, exports.ABS_MT_TOUCH_MAJOR);
            try {
                ioctl(fd, UI_SET_PROPBIT, exports.INPUT_PROP_DIRECT);
            }
            catch {
                /* optional on older kernels */
            }
            const absmax = new Int32Array(ABS_CNT);
            const absmin = new Int32Array(ABS_CNT);
            absmax[exports.ABS_X] = absMaxX;
            absmax[exports.ABS_Y] = absMaxY;
            absmax[exports.ABS_MT_SLOT] = Math.max(0, maxSlots - 1);
            absmax[exports.ABS_MT_TRACKING_ID] = 65535;
            absmax[exports.ABS_MT_POSITION_X] = absMaxX;
            absmax[exports.ABS_MT_POSITION_Y] = absMaxY;
            absmax[exports.ABS_MT_PRESSURE] = 255;
            absmax[exports.ABS_MT_TOUCH_MAJOR] = 255;
            writeUserDev(fd, name, 
            /*bustype*/ 0x03, 
            /*vendor*/ 0x0001, 
            /*product*/ 0x0002, absmin, absmax);
            ioctl(fd, UI_DEV_CREATE, 0);
            return new UinputDevice(fd, name);
        }
        catch (err) {
            try {
                fs.closeSync(fd);
            }
            catch {
                /* */
            }
            throw err;
        }
    }
    /** Emit one or more events followed by SYN_REPORT. */
    emit(events) {
        if (this._disposed)
            throw new Error('uinput device disposed');
        const need = (events.length + 1) * EVENT_SIZE;
        const buf = need <= this._eventBuf.length ? this._eventBuf : Buffer.allocUnsafe(need);
        let off = 0;
        for (const e of events) {
            packEvent(e.type, e.code, e.value, buf, off);
            off += EVENT_SIZE;
        }
        packEvent(exports.EV_SYN, exports.SYN_REPORT, 0, buf, off);
        off += EVENT_SIZE;
        writeSync(this.fd, buf.subarray(0, off));
    }
    destroy() {
        if (this._disposed)
            return;
        this._disposed = true;
        try {
            ioctl(this.fd, UI_DEV_DESTROY, 0);
        }
        catch {
            /* best-effort */
        }
        try {
            fs.closeSync(this.fd);
        }
        catch {
            /* */
        }
    }
}
exports.UinputDevice = UinputDevice;
function writeUserDev(fd, name, bustype, vendor, product, absmin, absmax) {
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
function uinputAvailable() {
    try {
        // access(2) can succeed on a dead mknod; open is the real usability gate.
        const fd = fs.openSync('/dev/uinput', fs.constants.O_RDWR);
        fs.closeSync(fd);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=uinput.js.map