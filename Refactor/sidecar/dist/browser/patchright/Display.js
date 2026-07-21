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
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs"));
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * One Xvfb + matchbox WM per session. Runtime size changes recreate at exact geometry.
 */
class Display {
    number;
    _xvfb;
    _wm;
    _width;
    _height;
    constructor(number, xvfb, wm, width, height) {
        this.number = number;
        this._xvfb = xvfb;
        this._wm = wm;
        this._width = width;
        this._height = height;
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
        const xvfb = (0, child_process_1.spawn)('Xvfb', [
            `:${number}`,
            '-screen',
            '0',
            `${width}x${height}x24`,
            '-ac',
            '+extension',
            'GLX',
            '+extension',
            'RANDR',
            '+render',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        xvfb.stdout?.resume();
        xvfb.stderr?.resume();
        xvfb.on('error', (err) => {
            console.error(`[Xvfb :${number}] spawn error:`, err.message);
        });
        await Display.waitForLock(lockFile, xvfb, number);
        const wm = Display.tryStartWm(number);
        await new Promise((r) => setTimeout(r, 200));
        const display = new Display(number, xvfb, wm, width, height);
        const active = await display.readActiveGeometry();
        if (active.width !== width || active.height !== height) {
            await display.dispose();
            throw new Error(`Xvfb :${number} active geometry ${active.width}×${active.height} != requested ${width}×${height}`);
        }
        return display;
    }
    async recreate(width, height) {
        const number = this.number;
        await this.dispose();
        return Display.start(number, width, height);
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
    async dispose() {
        if (this._wm && this._wm.exitCode === null)
            this._wm.kill('SIGKILL');
        if (this._xvfb && this._xvfb.exitCode === null)
            this._xvfb.kill('SIGKILL');
        await Promise.all([
            this._wm ? Display.waitForExit(this._wm, 2_000) : Promise.resolve(),
            this._xvfb ? Display.waitForExit(this._xvfb, 2_000) : Promise.resolve(),
        ]);
        try {
            fs.unlinkSync(`/tmp/.X${this.number}-lock`);
        }
        catch {
            /* gone */
        }
    }
    static async waitForLock(lockFile, xvfb, number, timeoutMs = 10_000) {
        const deadline = Date.now() + timeoutMs;
        while (!fs.existsSync(lockFile)) {
            if (xvfb.exitCode !== null) {
                throw new Error(`Xvfb :${number} exited prematurely (code ${xvfb.exitCode}).`);
            }
            if (Date.now() >= deadline) {
                xvfb.kill();
                throw new Error(`Xvfb :${number} did not start within ${timeoutMs} ms.`);
            }
            await new Promise((r) => setTimeout(r, 50));
        }
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
/** Allocates unique X display numbers (starts at 100). */
class DisplayAllocator {
    next = 100;
    allocate() {
        return this.next++;
    }
}
exports.DisplayAllocator = DisplayAllocator;
//# sourceMappingURL=Display.js.map