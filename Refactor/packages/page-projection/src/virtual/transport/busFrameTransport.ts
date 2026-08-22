import type { FrameTransport, FrameTransportResult } from './frameTransport';
import type { ProjectionBus } from '../bus/projectionBus';

/** Nested algorithm: emitFrame via the bus; never opens a socket. */
export class BusFrameTransport implements FrameTransport {
  constructor(private readonly bus: ProjectionBus) {}

  send(bytes: Uint8Array): FrameTransportResult {
    this.bus.emitFrame(bytes);
    return 'accepted';
  }
}
