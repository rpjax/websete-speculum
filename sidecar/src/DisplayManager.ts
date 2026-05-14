import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Manages a single Xvfb virtual framebuffer + matchbox-window-manager.
 *
 * Each browser session gets its own display number so sessions are visually
 * isolated. The WM ensures Chrome receives proper focus and expose/damage
 * events are processed, eliminating cursor-trail artifacts.
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
     */
    static async start(
        number: number,
        width:  number,
        height: number,
    ): Promise<DisplayManager> {
        const lockFile = `/tmp/.X${number}-lock`;

        // If a stale lock file exists from a previous crash, remove it so
        // Xvfb can claim the display number.
        try { fs.unlinkSync(lockFile); } catch { /* did not exist */ }

        const xvfb = spawn('Xvfb', [
            `:${number}`,
            '-screen', '0', `${width}x${height}x24`,
            '-ac',               // disable access control
            '+extension', 'GLX', // required for compositing paths
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

        // Start a minimal window manager. matchbox-window-manager forces every
        // window to fill the screen and handles all X11 event plumbing.
        const wm = DisplayManager.tryStartWm(number);

        // Give the WM a moment to connect before Chrome tries to open a window.
        await new Promise<void>(r => setTimeout(r, 200));

        return new DisplayManager(number, xvfb, wm);
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
                env:   { ...process.env, DISPLAY: `:${displayNumber}` },
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
