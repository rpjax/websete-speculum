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
 * Xvfb allocates its shared-memory framebuffer at launch time and cannot grow
 * it.  Starting at 4096×2160 lets xrandr switch to any smaller or equal
 * resolution at runtime — including the user's actual viewport and any future
 * resize — without restarting the display server.
 *
 * The initial size passed by the caller is applied immediately via xrandr
 * after Xvfb starts (see applyXrandr), so Chrome always launches into the
 * correct resolution even though Xvfb's physical framebuffer is larger.
 */
export class VirtualDisplay {
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

    /** Xvfb child process PID, if spawned successfully. */
    get xvfbPid(): number | null {
        const pid = this._xvfb.pid;
        return typeof pid === 'number' && pid > 0 ? pid : null;
    }

    /** matchbox-window-manager child process PID, if running. */
    get wmPid(): number | null {
        const pid = this._wm?.pid;
        return typeof pid === 'number' && pid > 0 ? pid : null;
    }

    /**
     * Snap to an even multiple of 8 — Xvfb/xrandr rejects many odd sizes
     * (e.g. 1432×715 from a browser viewport) and leaves the CRTC at 4096×2160.
     */
    static snapSize(width: number, height: number): { width: number; height: number } {
        const CELL = 8;
        const snap = (n: number) => Math.max(CELL, Math.round(n / CELL) * CELL);
        return { width: snap(width), height: snap(height) };
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
    ): Promise<VirtualDisplay> {
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
        await VirtualDisplay.waitForLock(lockFile, xvfb, number);

        // Set the active resolution to the caller-requested size.
        // Chrome will launch and see this resolution (not 4096×2160).
        await VirtualDisplay.applyXrandr(number, width, height);

        // Start a minimal window manager. matchbox-window-manager forces every
        // window to fill the screen and handles all X11 event plumbing,
        // including forwarding RandR resize events to fullscreen windows.
        const wm = VirtualDisplay.tryStartWm(number);

        // Give the WM a moment to connect before Chrome tries to open a window.
        await new Promise<void>(r => setTimeout(r, 200));

        return new VirtualDisplay(number, xvfb, wm);
    }

    /** Runtime CRTC resize (session ResizeAsync). Best-effort like start(). */
    async resize(width: number, height: number): Promise<void> {
        await VirtualDisplay.applyXrandr(this.number, width, height);
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    /**
     * Computes a syntactically valid xrandr modeline for width×height @ 60 Hz.
     *
     * Xvfb is a virtual display — there is no real hardware to validate pixel
     * clock accuracy or blanking timings.  We use a simplified blanking
     * formula derived from the CVT standard that is accepted by xrandr without
     * requiring the `cvt` binary to be installed.
     *
     * Formula:
     *   Horizontal — 8 % H-sync pulse width (of H-total), rounded to the
     *   8-pixel character cell granularity; 12.5 % total blanking.
     *   Vertical   — 28 lines of blanking (3 front / 4 sync / 21 back),
     *   typical for a 60 Hz display.
     *   Pixel clock — H-total × V-total × 60, rounded to the nearest
     *   0.25 MHz (xrandr's mandatory clock-step granularity).
     */
    private static computeModeline(
        width:  number,
        height: number,
        hz = 60,
    ): { name: string; params: string[] } {
        const CELL  = 8;    // character cell granularity (pixels)
        const STEP  = 0.25; // pixel-clock step (MHz)
        const snapped = VirtualDisplay.snapSize(width, height);
        width = snapped.width;
        height = snapped.height;

        // ── Horizontal ────────────────────────────────────────────────────────
        // Active area rounded up to cell boundary, then add 12.5 % blanking
        // (also a multiple of 2 cells so the total stays on the cell grid).
        const hActive = Math.ceil(width  / CELL) * CELL;
        const hBlank  = Math.round(hActive * 0.125 / (CELL * 2)) * (CELL * 2);
        const hTotal  = hActive + hBlank;
        // H-sync pulse = 8 % of H-total, rounded to cell boundary.
        const hSync   = Math.round(0.08 * hTotal / CELL) * CELL;
        // Front porch fills half the blanking minus half the sync pulse.
        const hFront  = Math.round(hBlank / 2 - hSync / 2);
        const hSS     = hActive + hFront;
        const hSE     = hSS + hSync;

        // ── Vertical ──────────────────────────────────────────────────────────
        const vActive = height;
        const vFront  = 3;
        const vSync   = 4;
        const vBack   = 21;
        const vTotal  = vActive + vFront + vSync + vBack;
        const vSS     = vActive + vFront;
        const vSE     = vSS + vSync;

        // ── Pixel clock ───────────────────────────────────────────────────────
        const rawClock = hTotal * vTotal * hz / 1_000_000; // MHz
        const clock    = Math.round(rawClock / STEP) * STEP;

        // Name must match the active pixel geometry in params (not the raw CSS size).
        const name = `${hActive}x${vActive}_${hz}.00`;
        return {
            name,
            params: [
                clock.toFixed(2),
                String(hActive), String(hSS), String(hSE), String(hTotal),
                String(vActive), String(vSS), String(vSE), String(vTotal),
            ],
        };
    }

    /**
     * Applies a resolution change via xrandr.
     *
     * ── Why --fb alone cannot shrink the framebuffer ──────────────────────────
     * xrandr rejects `--fb WxH` when any active CRTC output is configured at a
     * larger mode.  Xvfb is launched at 4096×2160 (maximum SHM allocation), so
     * its initial CRTC is 4096×2160.  Calling `--fb 1280x720` fails with:
     *   "specified screen not large enough for output screen (4096x2160+0+0)".
     * The solution is to switch the output to the target mode WITH --fb in a
     * single xrandr invocation (`--output X --mode M --fb WxH`).  xrandr then
     * resizes the CRTC and the framebuffer atomically, satisfying the constraint.
     */
    private static async applyXrandr(
        displayNum: number,
        width:      number,
        height:     number,
    ): Promise<void> {
        const display = `:${displayNum}`;
        const env     = { ...process.env as Record<string, string>, DISPLAY: display };
        const snapped = VirtualDisplay.snapSize(width, height);
        width = snapped.width;
        height = snapped.height;

        try {
            // ── Step 1: compute modeline in TypeScript ────────────────────────
            // No `cvt` binary required.  The formula produces values accepted by
            // Xvfb's xrandr driver (virtual hardware, no timing validation).
            const { name: modeName, params: modeParams } =
                VirtualDisplay.computeModeline(width, height);

            // ── Step 2: find the xrandr output name ───────────────────────────
            // Xvfb with RANDR extension exposes one virtual output.
            // Its name varies by version: "VIRTUAL1", "screen", etc.
            const { stdout: xrOut } =
                await execFileAsync('xrandr', ['--display', display], { env });

            const outputMatch = xrOut.match(/^(\S+)\s+(?:connected|disconnected)/m);
            if (!outputMatch) {
                throw new Error(`No xrandr output found in:\n${xrOut.trim()}`);
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

            // ── Step 4: switch output + framebuffer atomically ────────────────
            // Combining --output --mode --fb in one invocation is mandatory:
            // the CRTC mode changes to WxH first, then --fb WxH succeeds
            // because the output no longer exceeds the requested size.
            await execFileAsync('xrandr', [
                '--display', display,
                '--output',  outputName,
                '--mode',    modeName,
                '--fb',      `${width}x${height}`,
            ], { env });

            console.log(`[DisplayManager :${displayNum}] xrandr → ${width}×${height} (mode ${modeName})`);
        } catch (err) {
            console.error(
                `[DisplayManager :${displayNum}] xrandr failed (${(err as Error).message.split('\n')[0]}). ` +
                `Display stays at its current resolution.`,
            );
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
        // Send SIGKILL to both processes immediately and simultaneously.
        // Neither WM nor Xvfb holds user data — there is no value in a graceful
        // SIGTERM + wait cycle. SIGKILL causes exit within milliseconds.
        if (this._wm   && this._wm.exitCode   === null) this._wm.kill('SIGKILL');
        if (this._xvfb &&  this._xvfb.exitCode === null) this._xvfb.kill('SIGKILL');

        // Wait for both to confirm exit in parallel (should be near-instant after SIGKILL).
        // The 2 s timeout is just a safety net — it should never be reached in practice.
        await Promise.all([
            this._wm   ? VirtualDisplay.waitForExit(this._wm,   2_000) : Promise.resolve(),
            this._xvfb ? VirtualDisplay.waitForExit(this._xvfb, 2_000) : Promise.resolve(),
        ]);

        // Clean up stale lock file so the display number can be reused.
        try { fs.unlinkSync(`/tmp/.X${this.number}-lock`); } catch { /* already gone */ }
    }

    /**
     * Waits for a child process to exit, with a hard timeout.
     * Does NOT send any signal — callers must send SIGTERM before calling this.
     */
    private static waitForExit(
        proc:      ReturnType<typeof spawn>,
        timeoutMs: number,
    ): Promise<void> {
        return new Promise<void>(resolve => {
            if (proc.exitCode !== null) { resolve(); return; }
            const timer = setTimeout(resolve, timeoutMs);
            proc.once('exit', () => { clearTimeout(timer); resolve(); });
        });
    }
}
