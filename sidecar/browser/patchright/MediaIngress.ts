import type { BrowserSessionEvents } from '../BrowserSession';

/**
 * Camera/mic ingress — TODO: v4l2loopback per session + Chrome getUserMedia binding.
 * Until then, push paths fail closed (no fake file append).
 * Permission events remain on BrowserSessionEvents for when GUM is wired.
 */
export class MediaIngress {
  constructor(
    _sessionId: string,
    private readonly events: BrowserSessionEvents,
  ) {
    void this.events;
  }

  async pushCameraFrame(_frame: Uint8Array): Promise<void> {
    throw Object.assign(new Error('media_ingress_not_implemented'), {
      code: 'FAILED_PRECONDITION',
    });
  }

  async pushMicrophoneAudio(_chunk: Uint8Array): Promise<void> {
    throw Object.assign(new Error('media_ingress_not_implemented'), {
      code: 'FAILED_PRECONDITION',
    });
  }

  async dispose(): Promise<void> {
    /* nothing to clean until v4l2 path exists */
  }
}
