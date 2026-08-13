/**
 * Builds the pre-script that assigns Virtual projection config on `globalThis`
 * before `virtual.js` runs.
 */

import { PROJECTION_CONFIG_GLOBAL } from '../virtual/config/projectionConfig';
import type { ProjectionTransportKind } from '../virtual/config/projectionConfig';
import type { ProjectionTelemetryConfig } from '../models/telemetry';

export type ProjectionConfigPreScriptOptions = {
  transport?: ProjectionTransportKind;
  dataPlaneUrl?: string;
  frameRateHz?: number;
  bufferedAmountWatermark?: number;
  maxFrameBytes?: number;
  /** Partial telemetry overrides (merged with Virtual defaults). */
  telemetry?: Partial<ProjectionTelemetryConfig>;
};

/**
 * Returns a JS statement string suitable for `addInitScript` / CDP evaluate-on-new-document,
 * injected **before** the main Virtual bundle.
 */
export function buildConfigPreScript(opts: ProjectionConfigPreScriptOptions): string {
  const transport = opts.transport ?? 'loopback';
  const dataPlaneUrl = (opts.dataPlaneUrl ?? '').trim();
  if (transport === 'loopback' && dataPlaneUrl.length === 0) {
    throw new Error('buildConfigPreScript: dataPlaneUrl is required when transport is "loopback"');
  }

  const payload: Record<string, unknown> = {
    transport,
  };
  if (dataPlaneUrl.length > 0) payload.dataPlaneUrl = dataPlaneUrl;
  if (opts.frameRateHz !== undefined) payload.frameRateHz = opts.frameRateHz;
  if (opts.bufferedAmountWatermark !== undefined) {
    payload.bufferedAmountWatermark = opts.bufferedAmountWatermark;
  }
  if (opts.maxFrameBytes !== undefined) payload.maxFrameBytes = opts.maxFrameBytes;
  if (opts.telemetry !== undefined) payload.telemetry = opts.telemetry;

  return `globalThis.${PROJECTION_CONFIG_GLOBAL}=${JSON.stringify(payload)};`;
}
