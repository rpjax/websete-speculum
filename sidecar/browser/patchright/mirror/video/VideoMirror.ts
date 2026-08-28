import type { CDPSession } from 'patchright';
import { Screencast } from '../../Screencast';

/**
 * Thin Video Streaming mirror facade — only constructed when MirrorMode is VideoStreaming.
 */
export class VideoMirror {
  private onFrame: ((jpeg: Uint8Array) => void) | null = null;

  private constructor(private screencast: Screencast) {}

  static async start(
    cdp: CDPSession,
    encodeWidth: number,
    encodeHeight: number,
    onFrame: (jpeg: Uint8Array) => void,
    cssWidth: number,
    cssHeight: number,
  ): Promise<VideoMirror> {
    const screencast = await Screencast.start(
      cdp,
      encodeWidth,
      encodeHeight,
      onFrame,
      cssWidth,
      cssHeight,
    );
    const mirror = new VideoMirror(screencast);
    mirror.onFrame = onFrame;
    return mirror;
  }

  async restart(
    encodeWidth: number,
    encodeHeight: number,
    cssWidth: number,
    cssHeight: number,
    cdp?: CDPSession,
  ): Promise<void> {
    if (!this.onFrame) return;
    await this.screencast.restart(
      encodeWidth,
      encodeHeight,
      this.onFrame,
      cdp,
      cssWidth,
      cssHeight,
    );
  }

  async stop(): Promise<void> {
    await this.screencast.stop();
  }

  get underlying(): Screencast {
    return this.screencast;
  }
}
