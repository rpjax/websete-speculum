/**
 * Chromium ↔ Sidecar data-plane channels (mux over one loopback WebSocket).
 *
 * Values are wire-stable: never renumber; only append.
 * Frame bodies stay on {@link PlaneChannel.Frame} — opaque PP bytes, own backpressure.
 */

export enum PlaneChannel {
  /** PageProjection frame / part bytes (§5.5). Opaque; do not parse on the plane. */
  Frame = 1,
  /** Reserved — rate hints / non-frame control later. */
  Control = 2,
  /** Projection telemetry (Virtual → sidecar push). Compact JSON UTF-8 payload. */
  Telemetry = 3,
}

export function planeChannelName(ch: PlaneChannel): string {
  switch (ch) {
    case PlaneChannel.Frame:
      return 'frame';
    case PlaneChannel.Control:
      return 'control';
    case PlaneChannel.Telemetry:
      return 'telemetry';
    default:
      return `channel(${ch as number})`;
  }
}
