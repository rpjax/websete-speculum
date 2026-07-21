import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

export type DisplayGeometry = { width: number; height: number };

/**
 * One Xvfb + matchbox WM per session. Runtime size changes recreate at exact geometry.
 */
export class Display {
  readonly number: number;
  private _xvfb: ChildProcess;
  private _wm: ChildProcess | null;
  private _width: number;
  private _height: number;

  private constructor(
    number: number,
    xvfb: ChildProcess,
    wm: ChildProcess | null,
    width: number,
    height: number,
  ) {
    this.number = number;
    this._xvfb = xvfb;
    this._wm = wm;
    this._width = width;
    this._height = height;
  }

  get displayEnv(): string {
    return `:${this.number}`;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  static async start(number: number, width: number, height: number): Promise<Display> {
    const lockFile = `/tmp/.X${number}-lock`;
    try {
      fs.unlinkSync(lockFile);
    } catch {
      /* missing */
    }

    const xvfb = spawn(
      'Xvfb',
      [
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
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    xvfb.stdout?.resume();
    xvfb.stderr?.resume();
    xvfb.on('error', (err) => {
      console.error(`[Xvfb :${number}] spawn error:`, err.message);
    });

    await Display.waitForLock(lockFile, xvfb, number);
    const wm = Display.tryStartWm(number);
    await new Promise<void>((r) => setTimeout(r, 200));

    const display = new Display(number, xvfb, wm, width, height);
    const active = await display.readActiveGeometry();
    if (active.width !== width || active.height !== height) {
      await display.dispose();
      throw new Error(
        `Xvfb :${number} active geometry ${active.width}×${active.height} != requested ${width}×${height}`,
      );
    }
    return display;
  }

  async recreate(width: number, height: number): Promise<Display> {
    const number = this.number;
    await this.dispose();
    return Display.start(number, width, height);
  }

  async readActiveGeometry(): Promise<DisplayGeometry> {
    const display = this.displayEnv;
    const env = { ...process.env as Record<string, string>, DISPLAY: display };
    const { stdout } = await execFileAsync('xrandr', ['--display', display, '--current'], { env });
    const screen = stdout.match(/current\s+(\d+)\s+x\s+(\d+)/i);
    if (screen) return { width: Number(screen[1]), height: Number(screen[2]) };
    const mode = stdout.match(/(\d+)x(\d+)\s+[0-9.]+\*/);
    if (mode) return { width: Number(mode[1]), height: Number(mode[2]) };
    throw new Error(`Unable to parse active geometry from xrandr:\n${stdout.trim()}`);
  }

  async dispose(): Promise<void> {
    if (this._wm && this._wm.exitCode === null) this._wm.kill('SIGKILL');
    if (this._xvfb && this._xvfb.exitCode === null) this._xvfb.kill('SIGKILL');
    await Promise.all([
      this._wm ? Display.waitForExit(this._wm, 2_000) : Promise.resolve(),
      this._xvfb ? Display.waitForExit(this._xvfb, 2_000) : Promise.resolve(),
    ]);
    try {
      fs.unlinkSync(`/tmp/.X${this.number}-lock`);
    } catch {
      /* gone */
    }
  }

  private static async waitForLock(
    lockFile: string,
    xvfb: ChildProcess,
    number: number,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(lockFile)) {
      if (xvfb.exitCode !== null) {
        throw new Error(`Xvfb :${number} exited prematurely (code ${xvfb.exitCode}).`);
      }
      if (Date.now() >= deadline) {
        xvfb.kill();
        throw new Error(`Xvfb :${number} did not start within ${timeoutMs} ms.`);
      }
      await new Promise<void>((r) => setTimeout(r, 50));
    }
  }

  private static tryStartWm(displayNumber: number): ChildProcess | null {
    try {
      const wm = spawn('matchbox-window-manager', ['-use_titlebar', 'no'], {
        env: { ...process.env as Record<string, string>, DISPLAY: `:${displayNumber}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      wm.stdout?.resume();
      wm.stderr?.resume();
      wm.on('error', () => {});
      return wm;
    } catch {
      return null;
    }
  }

  private static waitForExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
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

/** Allocates unique X display numbers (starts at 100). */
export class DisplayAllocator {
  private next = 100;

  allocate(): number {
    return this.next++;
  }
}
