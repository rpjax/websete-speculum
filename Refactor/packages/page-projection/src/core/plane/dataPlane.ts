/**
 * Chromium ↔ Sidecar data plane — muxed WebSocket seam (E-03+).
 *
 * FrameProjection uses {@link PlaneChannel.Frame} via a FrameTransport adapter.
 * Additional channels can register handlers without a second socket.
 */

import type { PlaneChannel } from './channels';

export type DataPlaneResult = 'accepted' | 'deferred';

export type DataPlaneMessageHandler = (
  channel: PlaneChannel,
  payload: Uint8Array,
) => void;

/**
 * Bidirectional Chromium↔Sidecar data plane.
 * Impls: browser {@link LoopbackDataPlane}, Node {@link NodeDataPlane}.
 */
export type DataPlane = {
  open(url: string): void;
  close(): void;
  readonly isOpen: boolean;
  send(channel: PlaneChannel, payload: Uint8Array): DataPlaneResult;
  /** Replaces prior handler (single subscriber for now — expand to multicast later). */
  setHandler(handler: DataPlaneMessageHandler | null): void;
};
