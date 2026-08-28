/**
 * Frame send port (E-02 / E-03). Destination is an impl detail.
 * Impls in this folder: {@link LoopbackFrameTransport} (DataPlane mux),
 * {@link PlaneFrameTransport}, {@link ConsoleFrameTransport}, {@link NullFrameTransport}, …
 */

export type FrameTransportResult = 'accepted' | 'deferred';

export type FrameTransport = {
  send(bytes: Uint8Array): FrameTransportResult;
};
