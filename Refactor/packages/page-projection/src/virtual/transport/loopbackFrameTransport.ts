/**
 * Loopback WebSocket FrameTransport (E-03) — thin facade over DataPlane + Frame channel.
 */

import type { FrameTransport, FrameTransportResult } from './frameTransport';
import { LoopbackDataPlane } from './loopbackDataPlane';
import { PlaneFrameTransport } from './planeFrameTransport';

export type LoopbackFrameTransportOptions = {
  bufferedAmountWatermark?: number;
};

/**
 * Opens a muxed data plane and sends frames on {@link PlaneChannel.Frame}.
 * Prefer composing {@link LoopbackDataPlane} + {@link PlaneFrameTransport} when
 * the same socket must carry additional channels.
 */
export class LoopbackFrameTransport implements FrameTransport {
  private readonly plane: LoopbackDataPlane;
  private readonly frames: PlaneFrameTransport;

  constructor(opts: LoopbackFrameTransportOptions = {}) {
    this.plane = new LoopbackDataPlane(opts);
    this.frames = new PlaneFrameTransport(this.plane);
  }

  /** Underlying mux — register Control / Telemetry handlers here later. */
  get dataPlane(): LoopbackDataPlane {
    return this.plane;
  }

  get destinationUrl(): string | null {
    return this.plane.destinationUrl;
  }

  get isOpen(): boolean {
    return this.plane.isOpen;
  }

  open(url: string): void {
    this.plane.open(url);
  }

  whenOpen(timeoutMs?: number): Promise<void> {
    return this.plane.whenOpen(timeoutMs);
  }

  close(): void {
    this.plane.close();
  }

  send(bytes: Uint8Array): FrameTransportResult {
    return this.frames.send(bytes);
  }
}

export class NullFrameTransport implements FrameTransport {
  send(_bytes: Uint8Array): FrameTransportResult {
    return 'accepted';
  }
}
