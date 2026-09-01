/**
 * Chromium ↔ Sidecar data plane — muxed WebSocket seam (E-03+).
 *
 * FrameProjection uses {@link PlaneChannel.Frame} via a FrameTransport adapter.
 * Additional channels can register handlers without a second socket.
 * RPC: loopback `invoke` / `invoke-result` (§10.1c) — not CDP.
 */

import type { PlaneChannel } from './channels';
import type { LoopbackInvokeHandler, LoopbackInvokeResult } from '../loopback/envelope';

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
  /**
   * Sidecar → Virtual RPC (LB-04 idle timeout). Required on NodeDataPlane.
   * LoopbackDataPlane (Virtual) rejects.
   */
  invoke(
    name: string,
    args?: unknown,
    opts?: { timeoutMs?: number },
  ): Promise<LoopbackInvokeResult>;
  /** Virtual: handle sidecar invokes. No-op / unused on Node sidecar. */
  setInvokeHandler(handler: LoopbackInvokeHandler | null): void;
};

export type { LoopbackInvokeHandler, LoopbackInvokeResult };
