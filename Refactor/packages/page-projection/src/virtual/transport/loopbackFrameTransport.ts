/**
 * Loopback WebSocket FrameTransport (E-03) — thin facade over DataPlane + Frame channel.
 */

import type { FrameTransport, FrameTransportResult } from './frameTransport';
import {
  LoopbackDataPlane,
  type LoopbackDataPlaneOptions,
} from './loopbackDataPlane';
import { PlaneFrameTransport } from './planeFrameTransport';
import type { LoopbackConnectionStatus } from '../../core/loopback/envelope';

export type LoopbackFrameTransportOptions = LoopbackDataPlaneOptions;

/**
 * Opens a muxed data plane and sends frames on {@link PlaneChannel.Frame}.
 */
export class LoopbackFrameTransport implements FrameTransport {
  private readonly plane: LoopbackDataPlane;
  private readonly frames: PlaneFrameTransport;

  constructor(opts: LoopbackFrameTransportOptions = {}) {
    this.plane = new LoopbackDataPlane(opts);
    this.frames = new PlaneFrameTransport(this.plane);
  }

  get dataPlane(): LoopbackDataPlane {
    return this.plane;
  }

  get destinationUrl(): string | null {
    return this.plane.destinationUrl;
  }

  /** TCP OPEN only — prefer {@link isEstablished}. */
  get isOpen(): boolean {
    return this.plane.isOpen;
  }

  get isEstablished(): boolean {
    return this.plane.isEstablished;
  }

  get status(): LoopbackConnectionStatus {
    return this.plane.status;
  }

  open(url: string): void {
    this.plane.open(url);
  }

  establishConnection(opts: {
    sessionId: string;
    generation: number;
    timeoutMs?: number;
  }): Promise<void> {
    return this.plane.establishConnection(opts);
  }

  /** @deprecated Prefer {@link establishConnection}. */
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
