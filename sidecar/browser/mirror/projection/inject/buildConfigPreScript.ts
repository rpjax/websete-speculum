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
  // No `generation`: one config injection covers many document installs (a link click replaces
  // the document without the sidecar bumping anything), so it cannot name "which install". Virtual
  // acquires it per install from `initContext()` — runtime-redesign.md §6.
  /** CSSOM poll Hz. `0` off. Lab injects `5`. */
  cssomPollHz?: number;
  /** Loopback socket carrier. Managed path is always `extension`. */
  loopbackCarrier?: LoopbackCarrier;
  /** Bridge token when transport is loopback (required). */
  planeBridgeToken?: string;
  /**
   * Lab-only dual-boot / sequence diagnostics. Not part of frozen ProjectionConfig schema —
   * Virtual reads raw `__SPECULUM_PROJECTION__.diagBoot` (see bootDiag.ts).
   */
  diagBoot?: boolean;
  /**
   * CDP inject nonce — "which injection round is this", used only by the arm wrapper so a second
   * `evaluate` on the same heap is a no-op, and by the late-boot attempt key. Not the protocol
   * `generation` (that is acquired in-page by `initContext()`), and not part of the config payload.
   */
  injectNonce?: number;
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

  const loopbackCarrier: LoopbackCarrier = opts.loopbackCarrier ?? 'extension';
  if (loopbackCarrier !== 'extension') {
    throw new Error(
      `buildConfigPayload: loopbackCarrier must be "extension" (got ${String(loopbackCarrier)})`,
    );
  }
  const planeBridgeToken = (opts.planeBridgeToken ?? '').trim();
  if (transport === 'loopback' && planeBridgeToken.length === 0) {
    throw new Error('buildConfigPayload: planeBridgeToken is required when transport is "loopback"');
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
  if (opts.cssomPollHz !== undefined) payload.cssomPollHz = opts.cssomPollHz;
  if (opts.diagBoot === true) payload.diagBoot = true;
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
