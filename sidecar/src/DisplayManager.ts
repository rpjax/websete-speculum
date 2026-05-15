import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

/**
 * Manages a single Xvfb virtual framebuffer + matchbox-window-manager.
 *
 * Each browser session gets its own display number so sessions are visually
 * isolated. The WM ensures Chrome receives proper focus and expose/damage
 * events are processed, eliminating cursor-trail artifacts.
 *
 * ── Why 4096×2160 initial allocation ──────────────────────────────────────
 * Xvfb allocates its shared-memory framebuffer at launch time and cannot
 * grow it. Starting at 4096×2160 lets xrandr switch to any smaller or equal
 * resolution at runtime — including the user's actual viewport, and any
 * future resize — without restarting the display server.
 *
 * The initial size passed by the caller is applied immediately via xrandr
 * after Xvfb starts (see applyXrandr), so Chrome always launches into the
 * correct resolution even though Xvfb's physical framebuffer is larger.
 */
export class DisplayManager {
    readonly number: number;
    private _xvfb: ChildProcess;
    private _wm:   ChildProcess | null;

    private constructor(number: number, xvfb: ChildProcess, wm: ChildProcess | null) {
        this.number = number;
        this._xvfb  = xvfb;
        this._wm    = wm;
    }

    /** DISPLAY string, e.g. ":100" */
    get displayEnv(): string {
        return `:${this.number}`;
    }

    /**
     * Starts Xvfb on `:{number}` and waits until its lock file appears
     * (the conventional X11 server readiness signal), then starts matchbox.
     *
     * Xvfb is always started at the maximum allocation (4096×2160); the
     * caller-requested dimensions are applied immediately via xrandr so that
     * Chrome sees the correct resolution from the start.
     */
    static async start(
        number: number,
        width:  number,
        height: number,
    ): Promise<DisplayManager> {
        const lockFile = `/tmp/.X${number}-lock`;

        // Remove stale lock from a previous crash so Xvfb can claim the display.
        try { fs.unlinkSync(lockFile); } catch { /* did not exist */ }

        // Allocate the maximum possible framebuffer at launch time.
        // xrandr will set the active resolution to width×height right after.
        const xvfb = spawn('Xvfb', [
            `:${number}`,
            '-screen',    '0', '4096x2160x24',
            '-ac',                        // disable access control
            '+extension', 'GLX',          // required for compositing paths
            '+extension', 'RANDR',        // required for xrandr resizing
            '+render',
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Drain stdout/stderr so pipe buffers never fill and block Xvfb.
        xvfb.stdout?.resume();
        xvfb.stderr?.resume();

        xvfb.on('error', err => {
            console.error(`[Xvfb :${number}] spawn error:`, err.message);
        });

        // Poll for the X11 lock file — its existence signals the server is ready.
        await DisplayManager.waitForLock(lockFile, xvfb, number);

        // Set the active resolution to the caller-requested size.
        // Chrome will launch and see this resolution (not 4096×2160).
        await DisplayManager.applyXrandr(number, width, height);

        // Start a minimal window manager. matchbox-window-manager forces every
        // window to fill the screen and handles all X11 event plumbing,
        // including forwarding RandR resize events to fullscreen windows.
        const wm = DisplayManager.tryStartWm(number);

        // Give the WM a moment to connect before Chrome tries to open a window.
        await new Promise<void>(r => setTimeout(r, 200));

        return new DisplayManager(number, xvfb, wm);
    }

    /**
     * Changes the active virtual display resolution via xrandr.
     *
     * Strategy:
     *   1. Generate a modeline for the requested size with `cvt`.
     *   2. Register it with xrandr (--newmode / --addmode) — idempotent.
     *   3. Switch the virtual output to the new mode.
     *
     * If cvt or mode switching fails (e.g. the Xvfb version does not fully
     * support RandR output mode changes), we fall back to `xrandr --fb WxH`
     * which at minimum resizes the virtual framebuffer.
     */
    async resize(width: number, height: number): Promise<void> {
        await DisplayManager.applyXrandr(this.number, width, height);
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private static async applyXrandr(
        displayNum: number,
        width:      number,
        height:     number,
    ): Promise<void> {
        const display = `:${displayNum}`;
        const env     = { ...process.env as Record<string, string>, DISPLAY: display };

        try {
            // ── Step 1: generate a modeline for WxH@60Hz ─────────────────────
            // cvt output (example):
            //   # 1280x720 59.86 Hz (CVT 0.92M9) ...
            //   Modeline "1280x720_60.00"   74.50  1280 1344 1472 1664  720 ...
            const { stdout: cvtOut } =
                await execFileAsync('cvt', [String(width), String(height), '60']);

            const modelineMatch = cvtOut.match(/Modeline\s+"([^"]+)"\s+(.*)/);
            if (!modelineMatch) {
                throw new Error(`cvt output not parseable: ${cvtOut.trim()}`);
            }
            const [, modeName, rawParams] = modelineMatch;
            const modeParams = rawParams.trim().split(/\s+/);

            // ── Step 2: find the xrandr output name ───────────────────────────
            // Xvfb with RANDR extension typically exposes one virtual output.
            // Its name varies by Xvfb version: "VIRTUAL1", "screen", etc.
            const { stdout: xrOut } =
                await execFileAsync('xrandr', ['--display', display], { env });

            const outputMatch = xrOut.match(/^(\S+)\s+(?:connected|disconnected)/m);
            if (!outputMatch) {
                throw new Error(`No xrandr output found in: ${xrOut.trim()}`);
            }
            const outputName = outputMatch[1];

            // ── Step 3: register the mode (idempotent) ────────────────────────
            try {
                await execFileAsync(
                    'xrandr',
                    ['--display', display, '--newmode', modeName, ...modeParams],
                    { env },
                );
            } catch { /* mode already registered — ignore */ }

            try {
                await execFileAsync(
                    'xrandr',
                    ['--display', display, '--addmode', outputName, modeName],
                    { env },
                );
            } catch { /* already attached — ignore */ }

            // ── Step 4: switch output + framebuffer to the new size ───────────
            await execFileAsync('xrandr', [
                '--display', display,
                '--output',  outputName,
                '--mode',    modeName,
                '--fb',      `${width}x${height}`,
            ], { env });

            console.log(`[DisplayManager :${displayNum}] xrandr → ${width}×${height}`);
        } catch (err) {
            // Fallback: change only the framebuffer size. Some X11 clients
            // (including Chrome fullscreen) may still respond to this via
            // the ConfigureNotify / RandR notification path.
            console.warn(
                `[DisplayManager :${displayNum}] xrandr mode switch failed (${(err as Error).message}), ` +
                `falling back to --fb`,
            );
            try {
                await execFileAsync(
                    'xrandr',
                    ['--display', display, '--fb', `${width}x${height}`],
                    { env },
                );
            } catch (fbErr) {
                console.error(
                    `[DisplayManager :${displayNum}] xrandr --fb also failed:`,
                    (fbErr as Error).message,
                );
            }
        }
    }

    private static async waitForLock(
        lockFile: string,
        xvfb:     ChildProcess,
        number:   number,
        timeoutMs = 10_000,
    ): Promise<void> {
        const deadline = Date.now() + timeoutMs;

        while (!fs.existsSync(lockFile)) {
            if (xvfb.exitCode !== null) {
                throw new Error(
                    `Xvfb :${number} exited prematurely (code ${xvfb.exitCode}).`,
                );
            }
            if (Date.now() >= deadline) {
                xvfb.kill();
                throw new Error(`Xvfb :${number} did not start within ${timeoutMs} ms.`);
            }
            await new Promise<void>(r => setTimeout(r, 50));
        }
    }

    private static tryStartWm(displayNumber: number): ChildProcess | null {
        try {
            const wm = spawn('matchbox-window-manager', ['-use_titlebar', 'no'], {
                env:   { ...process.env as Record<string, string>, DISPLAY: `:${displayNumber}` },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            wm.stdout?.resume();
            wm.stderr?.resume();
            wm.on('error', () => { /* matchbox not installed — degrade gracefully */ });
            return wm;
        } catch {
            return null;
        }
    }

    async dispose(): Promise<void> {
        // Kill WM first; it holds a connection to the display.
        if (this._wm && this._wm.exitCode === null) {
            this._wm.kill();
            await new Promise<void>(r => this._wm!.once('exit', r));
        }

        if (this._xvfb.exitCode === null) {
            this._xvfb.kill();
            await new Promise<void>(r => this._xvfb.once('exit', r));
        }

        // Clean up stale lock file so the display number can be reused.
        try { fs.unlinkSync(`/tmp/.X${this.number}-lock`); } catch { /* already gone */ }
    }
}
