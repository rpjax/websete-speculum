import type { CDPSession } from 'patchright';
import { readJpegDimensions } from './jpeg-geometry';

/**
 * CDP Page.startScreencast → raw JPEG bytes (no wire framing).
 */
export class Screencast {
  private _cdp: CDPSession;
  private _stopped = false;
  private _handler: ((event: unknown) => void) | null = null;
  private _idleTimer: ReturnType<typeof setInterval> | null = null;
  private _lastFrameAt = 0;
  private _idleBusy = false;
  private _width = 0;
  private _height = 0;
  private _onFrame: ((jpeg: Uint8Array) => void) | null = null;

  static readonly IDLE_MS = 750;

  private constructor(cdp: CDPSession) {
    this._cdp = cdp;
  }

  static async start(
    cdp: CDPSession,
    width: number,
    height: number,
    onFrame: (jpeg: Uint8Array) => void,
  ): Promise<Screencast> {
    const sc = new Screencast(cdp);
    await sc._attach(width, height, onFrame);
    return sc;
  }

  setViewport(width: number, height: number): void {
    this._width = width;
    this._height = height;
  }

  async restart(
    width: number,
    height: number,
    onFrame: (jpeg: Uint8Array) => void,
    cdp?: CDPSession,
  ): Promise<void> {
    if (this._stopped) return;
    this._clearIdleTimer();
    try {
      await this._cdp.send('Page.stopScreencast', {});
    } catch {
      /* best-effort */
    }
    if (cdp) this._cdp = cdp;
    await this._attach(width, height, onFrame);
  }

  async stop(): Promise<void> {
    if (this._stopped) return;
    this._stopped = true;
    this._clearIdleTimer();
    if (this._handler) {
      this._cdp.off('Page.screencastFrame', this._handler);
      this._handler = null;
    }
    this._onFrame = null;
    try {
      await this._cdp.send('Page.stopScreencast', {});
    } catch {
      /* best-effort */
    }
  }

  private async _attach(
    width: number,
    height: number,
    onFrame: (jpeg: Uint8Array) => void,
  ): Promise<void> {
    if (this._handler) {
      this._cdp.off('Page.screencastFrame', this._handler);
    }
    const cdp = this._cdp;
    const self = this;
    this._onFrame = onFrame;
    this._width = width;
    this._height = height;
    this._lastFrameAt = Date.now();

    this._handler = function screencastFrameHandler(event: unknown): void {
      if (self._stopped) return;
      const ev = event as { data: string; sessionId: number };
      cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
      const jpeg = Buffer.from(ev.data, 'base64');
      if (!self._jpegMatchesViewport(jpeg)) return;
      self._lastFrameAt = Date.now();
      onFrame(new Uint8Array(jpeg));
    };

    this._cdp.on('Page.screencastFrame', this._handler);
    await this._cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      maxWidth: 4096,
      maxHeight: 2160,
      everyNthFrame: 1,
    });
    this._armIdleTimer();
  }

  private _armIdleTimer(): void {
    this._clearIdleTimer();
    this._idleTimer = setInterval(() => {
      void this._maybeIdleScreenshot();
    }, Screencast.IDLE_MS);
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
  }

  private async _maybeIdleScreenshot(): Promise<void> {
    if (this._stopped || this._idleBusy || !this._onFrame) return;
    if (Date.now() - this._lastFrameAt < Screencast.IDLE_MS) return;
    this._idleBusy = true;
    try {
      const result = (await this._cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 80,
      })) as { data: string };
      const jpeg = Buffer.from(result.data, 'base64');
      if (!this._jpegMatchesViewport(jpeg)) return;
      this._lastFrameAt = Date.now();
      this._onFrame(new Uint8Array(jpeg));
    } catch {
      /* best-effort */
    } finally {
      this._idleBusy = false;
    }
  }

  private _jpegMatchesViewport(jpeg: Buffer): boolean {
    if (this._width <= 0 || this._height <= 0) return true;
    const dims = readJpegDimensions(jpeg);
    if (!dims) return true;
    const dw = Math.abs(dims.width - this._width);
    const dh = Math.abs(dims.height - this._height);
    return dw <= 2 && dh <= 2;
  }
}
