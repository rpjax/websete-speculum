/**
 * FrameTransport adapter over {@link DataPlane} — only {@link PlaneChannel.Frame}.
 */

import { PlaneChannel } from '../../plane';
import type { DataPlane } from '../../plane';
import type { FrameTransport, FrameTransportResult } from './frameTransport';

export class PlaneFrameTransport implements FrameTransport {
  constructor(private readonly plane: DataPlane) {}

  send(bytes: Uint8Array): FrameTransportResult {
    return this.plane.send(PlaneChannel.Frame, bytes);
  }
}
