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
  /** §1.2 `EPOCH_RESET` trigger (Stage 3) — which generation this injection is. Defaults to `1`. */
  generation?: number;
  /** CSSOM poll Hz. `0` off. Lab injects `5`. */
  cssomPollHz?: number;
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
  if (opts.generation !== undefined) payload.generation = opts.generation;
  if (opts.cssomPollHz !== undefined) payload.cssomPollHz = opts.cssomPollHz;

  // This runs as its own separate injected `<script>` tag (Patchright leaves it attached to
  // the document — see bootstrap.ts's matching `currentScript.remove()` for why that matters);
  // clean up after itself the same way, or `virtual.js`'s own removal of *its* tag still leaves
  // this smaller one behind for the observer to mirror as page content.
  return `globalThis.${PROJECTION_CONFIG_GLOBAL}=${JSON.stringify(payload)};document.currentScript?.remove();`;
}
