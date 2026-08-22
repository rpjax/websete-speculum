/**
 * Sidecar session port — projection telemetry fan-out.
 * Lab and production sessions implement this; Virtual only pushes on DataPlane.
 */

import type { ProjectionTelemetryMessage } from '@speculum/page-projection/core/telemetry';

export type ProjectionTelemetrySink = {
  /**
   * Called when Virtual pushes a telemetry message on PlaneChannel.Telemetry.
   * Lab → client WSS; prod → .NET notification (later).
   */
  onProjectionTelemetry(message: ProjectionTelemetryMessage): void;
};
