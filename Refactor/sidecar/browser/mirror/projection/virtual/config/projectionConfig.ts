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
} from '../../models/telemetry';

export const PROJECTION_CONFIG_GLOBAL = '__SPECULUM_PROJECTION__' as const;

export type ProjectionTransportKind = 'console' | 'loopback';

export type ProjectionConfigBag = {
  dataPlaneUrl?: unknown;
  frameRateHz?: unknown;
  bufferedAmountWatermark?: unknown;
  maxFrameBytes?: unknown;
  transport?: unknown;
  telemetry?: unknown;
};

/** Resolved config available to Virtual modules after {@link readProjectionConfig}. */
export type ProjectionConfig = {
  transport: ProjectionTransportKind;
  /** Required when transport is `loopback`. Empty string for console. */
  dataPlaneUrl: string;
  frameRateHz: number;
  bufferedAmountWatermark: number;
  maxFrameBytes: number;
  telemetry: ProjectionTelemetryConfig;
};

const DEFAULTS = {
  transport: 'loopback' as ProjectionTransportKind,
  frameRateHz: 60,
  bufferedAmountWatermark: 256 * 1024,
  maxFrameBytes: 1 << 20,
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

function asTransport(value: unknown): ProjectionTransportKind {
  if (value === undefined || value === null) return DEFAULTS.transport;
  if (value === 'console' || value === 'loopback') return value;
  throw new Error(`ProjectionConfig.transport must be "console" | "loopback" (got ${String(value)})`);
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

  const resolved: ProjectionConfig = {
    transport,
    dataPlaneUrl,
    frameRateHz: asPositiveNumber(bag.frameRateHz, DEFAULTS.frameRateHz, 'frameRateHz'),
    bufferedAmountWatermark: asPositiveNumber(
      bag.bufferedAmountWatermark,
      DEFAULTS.bufferedAmountWatermark,
      'bufferedAmountWatermark',
    ),
    maxFrameBytes: asPositiveNumber(bag.maxFrameBytes, DEFAULTS.maxFrameBytes, 'maxFrameBytes'),
    telemetry: Object.freeze(resolveTelemetry(bag.telemetry)),
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
