import type { CDPSession } from 'patchright';
import { readJpegDimensions } from './jpeg-geometry';

/**
 * CDP Page.startScreencast → raw JPEG bytes (no wire framing).
 *
 * `maxWidth` / `maxHeight` are **downscale caps**, not upscale targets. When the
 * Chrome capture is already at CSS DIPs, frames arrive at CSS size even if the
 * encode cap is larger (Retina policy). The size filter must accept both the
 * encode target and the CSS viewport so we do not black-hole the stream.
 *
 * Idle pages keep the last screencast frame — do not inject Page.captureScreenshot
 * kick frames (clip-at-origin mismatches the scrolled viewport and "pushes" content).
 */
export class Screencast {
  private _cdp: CDPSession;
  private _stopped = false;
  private _handler: ((event: unknown) => void) | null = null;
  /** Expected JPEG pixel size when Chrome emits at encode scale. */
  private _encodeWidth = 0;
  private _encodeHeight = 0;
  /** Logical CSS viewport — Chrome often emits this size when capture ≤ encode cap. */
  private _cssWidth = 0;
  private _cssHeight = 0;

  private constructor(cdp: CDPSession) {
    this._cdp = cdp;
  }

  static async start(
    cdp: CDPSession,
    encodeWidth: number,
    encodeHeight: number,
    onFrame: (jpeg: Uint8Array) => void,
    cssWidth = encodeWidth,
    cssHeight = encodeHeight,
  ): Promise<Screencast> {
    const sc = new Screencast(cdp);
    await sc._attach(encodeWidth, encodeHeight, cssWidth, cssHeight, onFrame);
    return sc;
  }

  setExpectedSizes(
    encodeWidth: number,
    encodeHeight: number,
    cssWidth: number,
    cssHeight: number,
  ): void {
    this._encodeWidth = encodeWidth;
    this._encodeHeight = encodeHeight;
    this._cssWidth = cssWidth;
    this._cssHeight = cssHeight;
  }

  /**
   * Stop + reattach at a new encode size. Throws if already stopped (live resize
   * must not silently no-op after stopScreencast).
   */
  async restart(
    encodeWidth: number,
    encodeHeight: number,
    onFrame: (jpeg: Uint8Array) => void,
    cdp?: CDPSession,
    cssWidth = encodeWidth,
    cssHeight = encodeHeight,
  ): Promise<void> {
    await this.pauseForRestart();
    if (cdp) this._cdp = cdp;
    await this.completeRestart(encodeWidth, encodeHeight, onFrame, cdp, cssWidth, cssHeight);
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

  /** Reattach after {@link pauseForRestart} at the new encode / CSS sizes. */
  async completeRestart(
    encodeWidth: number,
    encodeHeight: number,
    onFrame: (jpeg: Uint8Array) => void,
    cdp?: CDPSession,
    cssWidth = encodeWidth,
    cssHeight = encodeHeight,
  ): Promise<void> {
    if (this._stopped) {
      throw new Error('screencast restart after stop');
    }
    if (cdp) this._cdp = cdp;
    await this._attach(encodeWidth, encodeHeight, cssWidth, cssHeight, onFrame);
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
    encodeWidth: number,
    encodeHeight: number,
    cssWidth: number,
    cssHeight: number,
    onFrame: (jpeg: Uint8Array) => void,
  ): Promise<void> {
    if (this._handler) {
      this._cdp.off('Page.screencastFrame', this._handler);
      this._handler = null;
    }

    const cdp = this._cdp;
    const self = this;
    const prevEncodeW = this._encodeWidth;
    const prevEncodeH = this._encodeHeight;
    const prevCssW = this._cssWidth;
    const prevCssH = this._cssHeight;
    this._encodeWidth = encodeWidth;
    this._encodeHeight = encodeHeight;
    this._cssWidth = cssWidth;
    this._cssHeight = cssHeight;

    const handler = function screencastFrameHandler(event: unknown): void {
      if (self._stopped) return;
      const ev = event as { data: string; sessionId: number };
      cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
      const jpeg = Buffer.from(ev.data, 'base64');
      if (!self._jpegMatchesExpected(jpeg)) return;
      onFrame(new Uint8Array(jpeg));
    };

    this._cdp.on('Page.screencastFrame', handler);
    try {
      await this._cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        maxWidth: encodeWidth,
        maxHeight: encodeHeight,
        everyNthFrame: 1,
      });
    } catch (err) {
      this._cdp.off('Page.screencastFrame', handler);
      this._encodeWidth = prevEncodeW;
      this._encodeHeight = prevEncodeH;
      this._cssWidth = prevCssW;
      this._cssHeight = prevCssH;
      throw err;
    }

    this._handler = handler;
  }

  /** @internal exposed for units */
  _jpegMatchesExpected(jpeg: Buffer): boolean {
    if (this._encodeWidth <= 0 || this._encodeHeight <= 0) return true;
    const dims = readJpegDimensions(jpeg);
    if (!dims) return true;
    const near = (w: number, h: number) =>
      Math.abs(dims.width - w) <= 2 && Math.abs(dims.height - h) <= 2;
    if (near(this._encodeWidth, this._encodeHeight)) return true;
    if (this._cssWidth > 0 && this._cssHeight > 0 && near(this._cssWidth, this._cssHeight)) {
      return true;
    }
    return false;
  }
}
