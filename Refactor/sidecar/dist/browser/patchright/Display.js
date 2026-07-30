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
exports.DisplayAllocator = exports.Display = void 0;
exports.buildXorgDummyConfigForTest = buildXorgDummyConfigForTest;
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * One Xorg (dummy driver) + matchbox WM per session.
 * Allocated once at policy max (display capacity). Runtime logical viewport
 * changes do not recreate the display — Chrome window + CDP metrics adapt instead.
 *
 * Xorg (not Xvfb) so per-session uinput devices attach and Chrome receives
 * real OS multitouch / absolute pointer events.
 */
class Display {
    number;
    _xorg;
    _wm;
    _width;
    _height;
    _configPath;
    constructor(number, xorg, wm, width, height, configPath) {
        this.number = number;
        this._xorg = xorg;
        this._wm = wm;
        this._width = width;
        this._height = height;
        this._configPath = configPath;
    }
    get displayEnv() {
        return `:${this.number}`;
    }
    get width() {
        return this._width;
    }
    get height() {
        return this._height;
    }
    static async start(number, width, height) {
        const lockFile = `/tmp/.X${number}-lock`;
        try {
            fs.unlinkSync(lockFile);
        }
        catch {
            /* missing */
        }
        fs.mkdirSync('/tmp/.X11-unix', { recursive: true });
        const configPath = path.join(os.tmpdir(), `speculum-xorg-${number}.conf`);
        fs.writeFileSync(configPath, buildXorgDummyConfig(width, height), 'utf8');
        const xorg = (0, child_process_1.spawn)('Xorg', [
            `:${number}`,
            '-config',
            configPath,
            '-nolisten',
            'tcp',
            '-noreset',
            '+extension',
            'GLX',
            '+extension',
            'RANDR',
            '-verbose',
            '1',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        xorg.stdout?.resume();
        xorg.stderr?.resume();
        xorg.on('error', (err) => {
            console.error(`[Xorg :${number}] spawn error:`, err.message);
        });
        await Display.waitForLock(lockFile, xorg, number);
        await Display.waitForXReady(number, xorg);
        const wm = Display.tryStartWm(number);
        await Display.waitForXReady(number, xorg);
        const display = new Display(number, xorg, wm, width, height, configPath);
        await display.ensureActiveGeometry(width, height);
        return display;
    }
    /**
     * @deprecated Soft viewport model never recreates the display. Throws if called.
     */
    async recreate(_width, _height) {
        throw new Error('Display.recreate is removed — allocate at policy max; soft-resize the logical viewport');
    }
    async readActiveGeometry() {
        const display = this.displayEnv;
        const env = { ...process.env, DISPLAY: display };
        const { stdout } = await execFileAsync('xrandr', ['--display', display, '--current'], { env });
        const screen = stdout.match(/current\s+(\d+)\s+x\s+(\d+)/i);
        if (screen)
            return { width: Number(screen[1]), height: Number(screen[2]) };
        const mode = stdout.match(/(\d+)x(\d+)\s+[0-9.]+\*/);
        if (mode)
            return { width: Number(mode[1]), height: Number(mode[2]) };
        throw new Error(`Unable to parse active geometry from xrandr:\n${stdout.trim()}`);
    }
    /**
     * Dummy driver's built-in default is often 1600×1200; force the capacity mode
     * via config Modes + xrandr fallback before proving geometry.
     */
    async ensureActiveGeometry(width, height) {
        let active = await this.readActiveGeometry();
        if (active.width === width && active.height === height)
            return;
        const env = { ...process.env, DISPLAY: this.displayEnv };
        const modeName = `${width}x${height}`;
        try {
            await execFileAsync('xrandr', ['--fb', `${width}x${height}`], { env });
        }
        catch {
            /* try output mode next */
        }
        try {
            const { stdout } = await execFileAsync('xrandr', ['--query'], { env });
            const output = stdout.match(/^([A-Za-z0-9-]+) connected/m)?.[1] ?? 'DEFAULT';
            try {
                await execFileAsync('xrandr', ['--output', output, '--mode', modeName], { env });
            }
            catch {
                const modeline = buildCvtModelineArgs(width, height);
                await execFileAsync('xrandr', ['--newmode', ...modeline], { env });
                await execFileAsync('xrandr', ['--addmode', output, modeName], { env });
                await execFileAsync('xrandr', ['--output', output, '--mode', modeName], { env });
            }
        }
        catch (err) {
            await this.dispose();
            throw new Error(`Xorg ${this.displayEnv} could not switch to ${width}×${height}: ${err.message}`);
        }
        active = await this.readActiveGeometry();
        if (active.width !== width || active.height !== height) {
            await this.dispose();
            throw new Error(`Xorg ${this.displayEnv} active geometry ${active.width}×${active.height} != requested ${width}×${height}`);
        }
    }
    async dispose() {
        if (this._wm && this._wm.exitCode === null)
            this._wm.kill('SIGKILL');
        if (this._xorg && this._xorg.exitCode === null)
            this._xorg.kill('SIGKILL');
        await Promise.all([
            this._wm ? Display.waitForExit(this._wm, 2_000) : Promise.resolve(),
            this._xorg ? Display.waitForExit(this._xorg, 2_000) : Promise.resolve(),
        ]);
        try {
            fs.unlinkSync(`/tmp/.X${this.number}-lock`);
        }
        catch {
            /* gone */
        }
        try {
            fs.unlinkSync(this._configPath);
        }
        catch {
            /* gone */
        }
    }
    static async waitForLock(lockFile, xorg, number, timeoutMs = 10_000) {
        const deadline = Date.now() + timeoutMs;
        while (!fs.existsSync(lockFile)) {
            if (xorg.exitCode !== null) {
                throw new Error(`Xorg :${number} exited prematurely (code ${xorg.exitCode}).`);
            }
            if (Date.now() >= deadline) {
                xorg.kill();
                throw new Error(`Xorg :${number} did not start within ${timeoutMs} ms.`);
            }
            await new Promise((r) => setTimeout(r, 50));
        }
    }
    /** Poll until xrandr can talk to the display (no fixed sleep). */
    static async waitForXReady(number, xorg, timeoutMs = 10_000) {
        const display = `:${number}`;
        const env = { ...process.env, DISPLAY: display };
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (xorg.exitCode !== null) {
                throw new Error(`Xorg :${number} exited prematurely (code ${xorg.exitCode}).`);
            }
            try {
                await execFileAsync('xrandr', ['--display', display, '--query'], { env });
                return;
            }
            catch {
                await new Promise((r) => setTimeout(r, 50));
            }
        }
        xorg.kill();
        throw new Error(`Xorg :${number} not ready for clients within ${timeoutMs} ms.`);
    }
    static tryStartWm(displayNumber) {
        try {
            const wm = (0, child_process_1.spawn)('matchbox-window-manager', ['-use_titlebar', 'no'], {
                env: { ...process.env, DISPLAY: `:${displayNumber}` },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            wm.stdout?.resume();
            wm.stderr?.resume();
            wm.on('error', () => { });
            return wm;
        }
        catch {
            return null;
        }
    }
    static waitForExit(proc, timeoutMs) {
        return new Promise((resolve) => {
            if (proc.exitCode !== null) {
                resolve();
                return;
            }
            const timer = setTimeout(resolve, timeoutMs);
            proc.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
}
exports.Display = Display;
function buildXorgDummyConfig(width, height) {
    const modeName = `${width}x${height}`;
    const modeline = buildCvtModelineLine(width, height);
    // VideoRam is KiB; need ≥ width*height*4 bytes for 24/32-bpp framebuffer.
    const videoRamKiB = Math.max(256000, Math.ceil((width * height * 4) / 1024) + 16384);
    return `
Section "ServerFlags"
  Option "AutoAddDevices" "true"
  Option "AutoEnableDevices" "false"
  Option "AllowEmptyInput" "true"
EndSection

Section "InputClass"
  Identifier "speculum-libinput"
  MatchDevicePath "/dev/input/event*"
  Driver "libinput"
  Option "Floating" "false"
EndSection

Section "Device"
  Identifier "speculum-dummy"
  Driver "dummy"
  VideoRam ${videoRamKiB}
EndSection

Section "Monitor"
  Identifier "speculum-monitor"
  HorizSync 1.0 - 512.0
  VertRefresh 1.0 - 200.0
  ${modeline}
EndSection

Section "Screen"
  Identifier "speculum-screen"
  Device "speculum-dummy"
  Monitor "speculum-monitor"
  DefaultDepth 24
  SubSection "Display"
    Depth 24
    Modes "${modeName}"
    Virtual ${width} ${height}
  EndSubSection
EndSection

Section "ServerLayout"
  Identifier "speculum-layout"
  Screen "speculum-screen"
EndSection
`.trimStart();
}
/** @internal Exported for unit tests (Xorg ServerFlags policy). */
function buildXorgDummyConfigForTest(width, height) {
    return buildXorgDummyConfig(width, height);
}
/** CVT-like modeline line for xorg.conf Monitor section. */
function buildCvtModelineLine(width, height) {
    const m = computeCvtMode(width, height);
    return `Modeline "${width}x${height}" ${m.dotClockMhz.toFixed(2)} ${m.hDisp} ${m.hSyncStart} ${m.hSyncEnd} ${m.hTotal} ${m.vDisp} ${m.vSyncStart} ${m.vSyncEnd} ${m.vTotal} -hsync +vsync`;
}
/** Args for `xrandr --newmode` (name + timings). */
function buildCvtModelineArgs(width, height) {
    const m = computeCvtMode(width, height);
    return [
        `${width}x${height}`,
        m.dotClockMhz.toFixed(2),
        String(m.hDisp),
        String(m.hSyncStart),
        String(m.hSyncEnd),
        String(m.hTotal),
        String(m.vDisp),
        String(m.vSyncStart),
        String(m.vSyncEnd),
        String(m.vTotal),
        '-hsync',
        '+vsync',
    ];
}
/**
 * Simplified CVT (Coordinated Video Timings) for 60Hz progressive — enough for
 * xf86-video-dummy / xrandr; not a full VESA CVT implementation.
 */
function computeCvtMode(width, height) {
    const vRefresh = 60;
    const hDisp = width;
    const vDisp = height;
    const hMargin = 0;
    const vMargin = 0;
    const vSync = 10;
    const hSyncPercent = 8;
    const vFrontPorch = 3;
    const hActive = hDisp + hMargin * 2;
    const vActive = vDisp + vMargin * 2;
    const hBlank = Math.floor((hActive * 18.0) / 100.0 / 16.0) * 16;
    const hTotal = hActive + hBlank;
    const hSyncWidth = Math.floor((hTotal * hSyncPercent) / 100.0 / 8.0) * 8;
    const hSyncStart = hActive + Math.floor(hBlank / 2) - hSyncWidth;
    const hSyncEnd = hSyncStart + hSyncWidth;
    const vBlankMin = Math.ceil((550.0 * vRefresh * vActive) / 1_000_000.0) + 1;
    const vTotal = vActive + Math.max(vBlankMin, vFrontPorch + vSync + 1);
    const vSyncStart = vActive + vFrontPorch;
    const vSyncEnd = vSyncStart + vSync;
    const dotClockMhz = (hTotal * vTotal * vRefresh) / 1_000_000.0;
    return {
        dotClockMhz,
        hDisp,
        hSyncStart,
        hSyncEnd,
        hTotal,
        vDisp,
        vSyncStart,
        vSyncEnd,
        vTotal,
    };
}
/** Allocates unique X display numbers (starts at 100). */
class DisplayAllocator {
    next = 100;
    allocate() {
        return this.next++;
    }
}
exports.DisplayAllocator = DisplayAllocator;
//# sourceMappingURL=Display.js.map