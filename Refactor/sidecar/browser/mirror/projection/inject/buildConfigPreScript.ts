/**
 * Builds the pre-script that assigns Virtual projection config on `globalThis`
 * before `virtual.js` runs.
 */

import { PROJECTION_CONFIG_GLOBAL } from '@speculum/page-projection/virtual/config/projectionConfig';
import type { ProjectionTransportKind, LoopbackCarrier } from '@speculum/page-projection/virtual/config/projectionConfig';
import type { ProjectionTelemetryConfig } from '@speculum/page-projection/core/telemetry';

export type ProjectionConfigPreScriptOptions = {
  /** Loopback hello session id (LB-08). Required when transport is loopback. */
  sessionId?: string;
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
  /** Loopback socket carrier. Default `extension` for managed Chrome. */
  loopbackCarrier?: LoopbackCarrier;
  /** Bridge token when loopbackCarrier is `extension`. */
  planeBridgeToken?: string;
};

export function buildConfigPayload(opts: ProjectionConfigPreScriptOptions): Record<string, unknown> {
  const transport = opts.transport ?? 'loopback';
  const dataPlaneUrl = (opts.dataPlaneUrl ?? '').trim();
  const sessionId = (opts.sessionId ?? '').trim();
  if (transport === 'loopback' && dataPlaneUrl.length === 0) {
    throw new Error('buildConfigPayload: dataPlaneUrl is required when transport is "loopback"');
  }
  if (transport === 'loopback' && sessionId.length === 0) {
    throw new Error('buildConfigPayload: sessionId is required when transport is "loopback"');
  }

  const loopbackCarrier = opts.loopbackCarrier ?? 'extension';
  const planeBridgeToken = (opts.planeBridgeToken ?? '').trim();
  if (transport === 'loopback' && loopbackCarrier === 'extension' && planeBridgeToken.length === 0) {
    throw new Error(
      'buildConfigPayload: planeBridgeToken is required when loopbackCarrier is "extension"',
    );
  }

  const payload: Record<string, unknown> = {
    transport,
    loopbackCarrier,
  };
  if (sessionId.length > 0) payload.sessionId = sessionId;
  if (dataPlaneUrl.length > 0) payload.dataPlaneUrl = dataPlaneUrl;
  if (planeBridgeToken.length > 0) payload.planeBridgeToken = planeBridgeToken;
  if (opts.frameRateHz !== undefined) payload.frameRateHz = opts.frameRateHz;
  if (opts.bufferedAmountWatermark !== undefined) {
    payload.bufferedAmountWatermark = opts.bufferedAmountWatermark;
  }
  if (opts.maxFrameBytes !== undefined) payload.maxFrameBytes = opts.maxFrameBytes;
  if (opts.telemetry !== undefined) payload.telemetry = opts.telemetry;
  if (opts.generation !== undefined) payload.generation = opts.generation;
  if (opts.cssomPollHz !== undefined) payload.cssomPollHz = opts.cssomPollHz;
  return payload;
}

/**
 * Returns a JS statement string suitable for `addInitScript` / CDP evaluate-on-new-document,
 * injected **before** the main Virtual bundle.
 */
export function buildConfigPreScript(opts: ProjectionConfigPreScriptOptions): string {
  const payload = buildConfigPayload(opts);
  return `globalThis.${PROJECTION_CONFIG_GLOBAL}=${JSON.stringify(payload)};`;
}
