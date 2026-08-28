/**
 * Virtual runtime config — read once from the pre-script global, then frozen.
 *
 * Sidecar injects `buildConfigPreScript(...)` *before* `virtual.js`, which assigns
 * `globalThis.__SPECULUM_PROJECTION__`. This module does not read Node env.
 */

import {
  DEFAULT_TELEMETRY_CONFIG,
  TELEMETRY_BOOL_CAPS,
  type ProjectionTelemetryConfig,
} from '../../core/telemetry';

export const PROJECTION_CONFIG_GLOBAL = '__SPECULUM_PROJECTION__' as const;

export type ProjectionTransportKind = 'console' | 'loopback' | 'discard';

export type LoopbackCarrier = 'page-ws' | 'extension';

export type ProjectionConfigBag = {
  sessionId?: unknown;
  dataPlaneUrl?: unknown;
  frameRateHz?: unknown;
  bufferedAmountWatermark?: unknown;
  maxFrameBytes?: unknown;
  transport?: unknown;
  loopbackCarrier?: unknown;
  planeBridgeToken?: unknown;
  telemetry?: unknown;
  generation?: unknown;
  /** CSSOM poll rate. `0` disables. Lab default 5. Independent of DOM `frameRateHz`. */
  cssomPollHz?: unknown;
};

/** Resolved config available to Virtual modules after {@link readProjectionConfig}. */
export type ProjectionConfig = {
  transport: ProjectionTransportKind;
  /** Loopback hello identity (LB-08). */
  sessionId: string;
  /** Required when transport is `loopback`. Empty string for console. */
  dataPlaneUrl: string;
  /** Loopback socket carrier when transport is `loopback`. */
  loopbackCarrier: LoopbackCarrier;
  /** Bridge auth token when loopbackCarrier is `extension`. */
  planeBridgeToken: string;
  frameRateHz: number;
  bufferedAmountWatermark: number;
  maxFrameBytes: number;
  telemetry: ProjectionTelemetryConfig;
  /**
   * §1.2/§4.1 `EPOCH_RESET` trigger (Stage 3): which generation *this* script injection is.
   * `1` for a session's first navigation (the client's own default — no `EPOCH_RESET` needed);
   * `> 1` means the orchestrator (`PageProjectionBrowserSession.navigate`) re-injected this bundle
   * for a hard navigation within the same session, and `bootstrap.ts` must announce it.
   */
  generation: number;
  /** `0` = CSSOM poller off. */
  cssomPollHz: number;
};

const DEFAULTS = {
  transport: 'loopback' as ProjectionTransportKind,
  loopbackCarrier: 'extension' as LoopbackCarrier,
  frameRateHz: 60,
  bufferedAmountWatermark: 256 * 1024,
  maxFrameBytes: 1 << 20,
  cssomPollHz: 0,
};

declare global {
  // eslint-disable-next-line no-var
  var __SPECULUM_PROJECTION__: ProjectionConfigBag | undefined;
}

let cached: Readonly<ProjectionConfig> | undefined;

function asPositiveNumber(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`ProjectionConfig.${label} must be a positive number (got ${String(value)})`);
  }
  return n;
}

function asNonNegativeNumber(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`ProjectionConfig.${label} must be >= 0 (got ${String(value)})`);
  }
  return n;
}

function asLoopbackCarrier(value: unknown): LoopbackCarrier {
  if (value === undefined || value === null) return DEFAULTS.loopbackCarrier;
  if (value === 'page-ws' || value === 'extension') return value;
  throw new Error(
    `ProjectionConfig.loopbackCarrier must be "page-ws" | "extension" (got ${String(value)})`,
  );
}

function asTransport(value: unknown): ProjectionTransportKind {
  if (value === undefined || value === null) return DEFAULTS.transport;
  if (value === 'console' || value === 'loopback' || value === 'discard') return value;
  throw new Error(
    `ProjectionConfig.transport must be "console" | "loopback" | "discard" (got ${String(value)})`,
  );
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  throw new Error(`ProjectionConfig.telemetry field must be boolean (got ${String(value)})`);
}

function resolveTelemetry(raw: unknown): ProjectionTelemetryConfig {
  if (raw === undefined || raw === null) {
    return { ...DEFAULT_TELEMETRY_CONFIG };
  }
  if (typeof raw !== 'object') {
    throw new Error('ProjectionConfig.telemetry must be an object');
  }
  const bag = raw as Record<string, unknown>;
  const resolved: ProjectionTelemetryConfig = { ...DEFAULT_TELEMETRY_CONFIG };
  for (const key of TELEMETRY_BOOL_CAPS) {
    resolved[key] = asBool(bag[key], DEFAULT_TELEMETRY_CONFIG[key]);
  }
  resolved.aggregateIntervalMs = asPositiveNumber(
    bag.aggregateIntervalMs,
    DEFAULT_TELEMETRY_CONFIG.aggregateIntervalMs,
    'telemetry.aggregateIntervalMs',
  );
  return resolved;
}

/**
 * Reads `globalThis.__SPECULUM_PROJECTION__` once, validates, freezes.
 * Call from bootstrap before wiring collaborators.
 */
export function readProjectionConfig(): Readonly<ProjectionConfig> {
  if (cached !== undefined) return cached;

  const raw = globalThis.__SPECULUM_PROJECTION__;
  if (raw === undefined || raw === null || typeof raw !== 'object') {
    throw new Error(
      `ProjectionConfig missing: inject buildConfigPreScript() before virtual.js ` +
        `(expected globalThis.${PROJECTION_CONFIG_GLOBAL})`,
    );
  }

  const bag = raw as ProjectionConfigBag;
  const transport = asTransport(bag.transport);
  const dataPlaneUrl =
    typeof bag.dataPlaneUrl === 'string' ? bag.dataPlaneUrl.trim() : '';

  if (transport === 'loopback' && dataPlaneUrl.length === 0) {
    throw new Error('ProjectionConfig.dataPlaneUrl is required when transport is "loopback"');
  }

  const sessionIdRaw = bag.sessionId;
  const sessionId =
    typeof sessionIdRaw === 'string' && sessionIdRaw.trim().length > 0
      ? sessionIdRaw.trim()
      : '';
  if (transport === 'loopback' && sessionId.length === 0) {
    throw new Error('ProjectionConfig.sessionId is required when transport is "loopback"');
  }

  const loopbackCarrier = asLoopbackCarrier(bag.loopbackCarrier);
  const planeBridgeTokenRaw = bag.planeBridgeToken;
  const planeBridgeToken =
    typeof planeBridgeTokenRaw === 'string' ? planeBridgeTokenRaw.trim() : '';
  if (transport === 'loopback' && loopbackCarrier === 'extension' && planeBridgeToken.length === 0) {
    throw new Error(
      'ProjectionConfig.planeBridgeToken is required when loopbackCarrier is "extension"',
    );
  }

  const resolved: ProjectionConfig = {
    transport,
    sessionId,
    dataPlaneUrl,
    loopbackCarrier,
    planeBridgeToken,
    frameRateHz: asPositiveNumber(bag.frameRateHz, DEFAULTS.frameRateHz, 'frameRateHz'),
    bufferedAmountWatermark: asPositiveNumber(
      bag.bufferedAmountWatermark,
      DEFAULTS.bufferedAmountWatermark,
      'bufferedAmountWatermark',
    ),
    maxFrameBytes: asPositiveNumber(bag.maxFrameBytes, DEFAULTS.maxFrameBytes, 'maxFrameBytes'),
    telemetry: Object.freeze(resolveTelemetry(bag.telemetry)),
    generation: asPositiveNumber(bag.generation, 1, 'generation'),
    cssomPollHz: asNonNegativeNumber(bag.cssomPollHz, DEFAULTS.cssomPollHz, 'cssomPollHz'),
  };

  cached = Object.freeze(resolved);
  return cached;
}

/** After {@link readProjectionConfig}; throws if not initialized. */
export function getProjectionConfig(): Readonly<ProjectionConfig> {
  if (cached === undefined) {
    throw new Error('ProjectionConfig not loaded — call readProjectionConfig() in bootstrap first');
  }
  return cached;
}

/** Test helper. */
export function clearProjectionConfigCache(): void {
  cached = undefined;
}
