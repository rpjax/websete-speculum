import type { CDPSession } from 'patchright';
import { readJpegDimensions } from './jpeg-geometry';

/**
 * CDP Page.startScreencast → raw JPEG bytes (no wire framing).
 * Encode maxWidth/maxHeight track the logical viewport so cost follows client size.
 *
 * Idle pages keep the last screencast frame — do not inject Page.captureScreenshot
 * kick frames (clip-at-origin mismatches the scrolled viewport and "pushes" content).
 */
export class Screencast {
  private _cdp: CDPSession;
  private _stopped = false;
  private _handler: ((event: unknown) => void) | null = null;
  private _width = 0;
  private _height = 0;

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

  /**
   * Stop + reattach at a new logical size. Throws if already stopped (live resize
   * must not silently no-op after stopScreencast).
   */
  async restart(
    width: number,
    height: number,
    onFrame: (jpeg: Uint8Array) => void,
    cdp?: CDPSession,
  ): Promise<void> {
    await this.pauseForRestart();
    if (cdp) this._cdp = cdp;
    await this.completeRestart(width, height, onFrame);
  }

  /**
   * Stop casting and clear the handler without marking the screencast stopped.
   * Call before applying new logical metrics so old-size frames are not filtered
   * into a black gap; pair with {@link completeRestart}.
   */
  async pauseForRestart(): Promise<void> {
    if (this._stopped) {
      throw new Error('screencast restart after stop');
    }
    try {
      await this._cdp.send('Page.stopScreencast', {});
    } catch {
      /* best-effort */
    }
    if (this._handler) {
      this._cdp.off('Page.screencastFrame', this._handler);
      this._handler = null;
    }
  }

  /** Reattach after {@link pauseForRestart} at the new encode size. */
  async completeRestart(
    width: number,
    height: number,
    onFrame: (jpeg: Uint8Array) => void,
    cdp?: CDPSession,
  ): Promise<void> {
    if (this._stopped) {
      throw new Error('screencast restart after stop');
    }
    if (cdp) this._cdp = cdp;
    await this._attach(width, height, onFrame);
  }

  async stop(): Promise<void> {
    if (this._stopped) return;
    this._stopped = true;
    if (this._handler) {
      this._cdp.off('Page.screencastFrame', this._handler);
      this._handler = null;
    }
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
      this._handler = null;
    }

    const cdp = this._cdp;
    const self = this;
    const prevW = this._width;
    const prevH = this._height;
    // Commit expected filter dims before start so early frames are not dropped/mismatched.
    this._width = width;
    this._height = height;

    const handler = function screencastFrameHandler(event: unknown): void {
      if (self._stopped) return;
      const ev = event as { data: string; sessionId: number };
      cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
      const jpeg = Buffer.from(ev.data, 'base64');
      if (!self._jpegMatchesViewport(jpeg)) return;
      onFrame(new Uint8Array(jpeg));
    };

    this._cdp.on('Page.screencastFrame', handler);
    try {
      await this._cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        maxWidth: width,
        maxHeight: height,
        everyNthFrame: 1,
      });
    } catch (err) {
      this._cdp.off('Page.screencastFrame', handler);
      this._width = prevW;
      this._height = prevH;
      throw err;
    }

    this._handler = handler;
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
