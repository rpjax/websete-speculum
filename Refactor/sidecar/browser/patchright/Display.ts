import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export type DisplayGeometry = { width: number; height: number };

/**
 * One Xorg (dummy driver) + matchbox WM per session.
 * Allocated once at policy max (display capacity). Runtime logical viewport
 * changes do not recreate the display — Chrome window + CDP metrics adapt instead.
 *
 * Xorg (not Xvfb) so per-session uinput devices attach and Chrome receives
 * real OS multitouch / absolute pointer events.
 */
export class Display {
  readonly number: number;
  private _xorg: ChildProcess;
  private _wm: ChildProcess | null;
  private _width: number;
  private _height: number;
  private _configPath: string;

  private constructor(
    number: number,
    xorg: ChildProcess,
    wm: ChildProcess | null,
    width: number,
    height: number,
    configPath: string,
  ) {
    this.number = number;
    this._xorg = xorg;
    this._wm = wm;
    this._width = width;
    this._height = height;
    this._configPath = configPath;
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
    fs.mkdirSync('/tmp/.X11-unix', { recursive: true });

    const configPath = path.join(os.tmpdir(), `speculum-xorg-${number}.conf`);
    fs.writeFileSync(configPath, buildXorgDummyConfig(width, height), 'utf8');

    const xorg = spawn(
      'Xorg',
      [
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
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

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
  async recreate(_width: number, _height: number): Promise<Display> {
    throw new Error('Display.recreate is removed — allocate at policy max; soft-resize the logical viewport');
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

  /**
   * Dummy driver's built-in default is often 1600×1200; force the capacity mode
   * via config Modes + xrandr fallback before proving geometry.
   */
  private async ensureActiveGeometry(width: number, height: number): Promise<void> {
    let active = await this.readActiveGeometry();
    if (active.width === width && active.height === height) return;

    const env = { ...process.env as Record<string, string>, DISPLAY: this.displayEnv };
    const modeName = `${width}x${height}`;
    try {
      await execFileAsync('xrandr', ['--fb', `${width}x${height}`], { env });
    } catch {
      /* try output mode next */
    }
    try {
      const { stdout } = await execFileAsync('xrandr', ['--query'], { env });
      const output = stdout.match(/^([A-Za-z0-9-]+) connected/m)?.[1] ?? 'DEFAULT';
      try {
        await execFileAsync('xrandr', ['--output', output, '--mode', modeName], { env });
      } catch {
        const modeline = buildCvtModelineArgs(width, height);
        await execFileAsync('xrandr', ['--newmode', ...modeline], { env });
        await execFileAsync('xrandr', ['--addmode', output, modeName], { env });
        await execFileAsync('xrandr', ['--output', output, '--mode', modeName], { env });
      }
    } catch (err) {
      await this.dispose();
      throw new Error(
        `Xorg ${this.displayEnv} could not switch to ${width}×${height}: ${(err as Error).message}`,
      );
    }

    active = await this.readActiveGeometry();
    if (active.width !== width || active.height !== height) {
      await this.dispose();
      throw new Error(
        `Xorg ${this.displayEnv} active geometry ${active.width}×${active.height} != requested ${width}×${height}`,
      );
    }
  }

  async dispose(): Promise<void> {
    if (this._wm && this._wm.exitCode === null) this._wm.kill('SIGKILL');
    if (this._xorg && this._xorg.exitCode === null) this._xorg.kill('SIGKILL');
    await Promise.all([
      this._wm ? Display.waitForExit(this._wm, 2_000) : Promise.resolve(),
      this._xorg ? Display.waitForExit(this._xorg, 2_000) : Promise.resolve(),
    ]);
    try {
      fs.unlinkSync(`/tmp/.X${this.number}-lock`);
    } catch {
      /* gone */
    }
    try {
      fs.unlinkSync(this._configPath);
    } catch {
      /* gone */
    }
  }

  private static async waitForLock(
    lockFile: string,
    xorg: ChildProcess,
    number: number,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(lockFile)) {
      if (xorg.exitCode !== null) {
        throw new Error(`Xorg :${number} exited prematurely (code ${xorg.exitCode}).`);
      }
      if (Date.now() >= deadline) {
        xorg.kill();
        throw new Error(`Xorg :${number} did not start within ${timeoutMs} ms.`);
      }
      await new Promise<void>((r) => setTimeout(r, 50));
    }
  }

  /** Poll until xrandr can talk to the display (no fixed sleep). */
  private static async waitForXReady(
    number: number,
    xorg: ChildProcess,
    timeoutMs = 10_000,
  ): Promise<void> {
    const display = `:${number}`;
    const env = { ...process.env as Record<string, string>, DISPLAY: display };
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (xorg.exitCode !== null) {
        throw new Error(`Xorg :${number} exited prematurely (code ${xorg.exitCode}).`);
      }
      try {
        await execFileAsync('xrandr', ['--display', display, '--query'], { env });
        return;
      } catch {
        await new Promise<void>((r) => setTimeout(r, 50));
      }
    }
    xorg.kill();
    throw new Error(`Xorg :${number} not ready for clients within ${timeoutMs} ms.`);
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

function buildXorgDummyConfig(width: number, height: number): string {
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
export function buildXorgDummyConfigForTest(width: number, height: number): string {
  return buildXorgDummyConfig(width, height);
}

/** CVT-like modeline line for xorg.conf Monitor section. */
function buildCvtModelineLine(width: number, height: number): string {
  const m = computeCvtMode(width, height);
  return `Modeline "${width}x${height}" ${m.dotClockMhz.toFixed(2)} ${m.hDisp} ${m.hSyncStart} ${m.hSyncEnd} ${m.hTotal} ${m.vDisp} ${m.vSyncStart} ${m.vSyncEnd} ${m.vTotal} -hsync +vsync`;
}

/** Args for `xrandr --newmode` (name + timings). */
function buildCvtModelineArgs(width: number, height: number): string[] {
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
function computeCvtMode(width: number, height: number): {
  dotClockMhz: number;
  hDisp: number;
  hSyncStart: number;
  hSyncEnd: number;
  hTotal: number;
  vDisp: number;
  vSyncStart: number;
  vSyncEnd: number;
  vTotal: number;
} {
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
export class DisplayAllocator {
  private next = 100;

  allocate(): number {
    return this.next++;
  }
}
