/**
 * Virtual runtime config — read once from SessionConfig (extension C2), then frozen.
 *
 * Extension MAIN sets `globalThis.__SPECULUM_PROJECTION__` after the async config gate
 * (runtime-redesign.md §0 #3). Bootstrap awaits {@link awaitProjectionConfig} before freeze.
 */

import {
  DEFAULT_TELEMETRY_CONFIG,
  TELEMETRY_BOOL_CAPS,
  type ProjectionTelemetryConfig,
} from '../../core/telemetry';
import { resolveRootUpwardPeer, UPWARD_PEER_GLOBAL } from '../runtime/initContext';

export const PROJECTION_CONFIG_GLOBAL = '__SPECULUM_PROJECTION__' as const;
export const PROJECTION_CONFIG_READY_GLOBAL = '__SPECULUM_PROJECTION_READY__' as const;

/** Config gate timeout — launch budget ConfigGate slice (not an independent 2s guillotine). */
export const CONFIG_GATE_TIMEOUT_MS = 17_000;

export type ProjectionTransportKind = 'console' | 'loopback' | 'discard';

/** Managed Chrome loopback carrier. Page-origin WS is not a product option (EP-08 / EP-15). */
export type LoopbackCarrier = 'extension';

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
  /** CSSOM poll rate. `0` disables. Lab default 5. Independent of DOM `frameRateHz`. */
  cssomPollHz?: unknown;
  configGateTimeoutMs?: unknown;
};

/** Resolved config available to Virtual modules after {@link awaitProjectionConfig}. */
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
  // No `generation` here on purpose (runtime-redesign.md §6): one config injection covers many
  // document installs (a link click replaces the document without the sidecar bumping anything),
  // so a config-sourced generation is stale for exactly the case that needs it. `generation` is
  // stated per install by `initContext()`.
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
  // eslint-disable-next-line no-var
  var __SPECULUM_PROJECTION_READY__: Promise<ProjectionConfigBag | null> | undefined;
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
  if (value === 'extension') return value;
  throw new Error(
    `ProjectionConfig.loopbackCarrier must be "extension" (got ${String(value)}); page-origin WS is not a product carrier`,
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

function freezeBag(raw: ProjectionConfigBag): Readonly<ProjectionConfig> {
  const bag = raw;
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
  if (transport === 'loopback' && planeBridgeToken.length === 0) {
    throw new Error(
      'ProjectionConfig.planeBridgeToken is required when transport is "loopback"',
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
    cssomPollHz: asNonNegativeNumber(bag.cssomPollHz, DEFAULTS.cssomPollHz, 'cssomPollHz'),
  };

  cached = Object.freeze(resolved);
  return cached;
}

/**
 * Async config gate (E-11 amended): wait for the extension bridge to publish SessionConfig,
 * then freeze once. Nested timeout → `null` (dormant). Root timeout / missing → throw.
 *
 * Root also requires {@link UPWARD_PEER_GLOBAL} from `runtime-bridge.js` before freeze — a bare
 * `__SPECULUM_PROJECTION__` (stale CDP inject / old image) must not pass the gate and then die
 * at `initContext` with a less obvious error.
 */
export async function awaitProjectionConfig(opts?: {
  role?: 'root' | 'nested';
  timeoutMs?: number;
}): Promise<Readonly<ProjectionConfig> | null> {
  if (cached !== undefined) return cached;

  const role =
    opts?.role ??
    (typeof window !== 'undefined' && window.parent === window ? 'root' : 'nested');
  const timeoutMs = opts?.timeoutMs ?? CONFIG_GATE_TIMEOUT_MS;

  const requireRootUpwardPeer = (): void => {
    if (role !== 'root') return;
    if (resolveRootUpwardPeer() !== null) return;
    throw new Error(
      `[speculumProjection] SessionConfig without upward peer — ` +
        `globalThis.${UPWARD_PEER_GLOBAL} missing. ` +
        `runtime-bridge.js did not install (extension MAIN order / stale lab image / CONFIG without bridge). ` +
        `Root cannot proceed.`,
    );
  };

  const ready = globalThis.__SPECULUM_PROJECTION_READY__;
  if (ready !== undefined) {
    let bag: ProjectionConfigBag | null;
    try {
      bag = await Promise.race([
        ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
    } catch (err) {
      if (role === 'nested') return null;
      throw err;
    }
    if (bag === null || bag === undefined) {
      if (role === 'nested') return null;
      return null;
    }
    requireRootUpwardPeer();
    return freezeBag(bag);
  }

  const raw = globalThis.__SPECULUM_PROJECTION__;
  if (raw !== undefined && raw !== null && typeof raw === 'object') {
    requireRootUpwardPeer();
    return freezeBag(raw as ProjectionConfigBag);
  }

  if (role === 'nested') return null;
  throw new Error(
    `ProjectionConfig missing: SessionConfig was not delivered before Virtual boot ` +
      `(expected globalThis.${PROJECTION_CONFIG_GLOBAL} via extension runtime bridge)`,
  );
}

/**
 * Synchronous freeze after the gate. Prefer {@link awaitProjectionConfig} at bootstrap.
 * Sync read remains for tests that pre-assign the global.
 */
export function readProjectionConfig(): Readonly<ProjectionConfig> {
  if (cached !== undefined) return cached;

  const raw = globalThis.__SPECULUM_PROJECTION__;
  if (raw === undefined || raw === null || typeof raw !== 'object') {
    throw new Error(
      `ProjectionConfig missing: await awaitProjectionConfig() in bootstrap ` +
        `(expected globalThis.${PROJECTION_CONFIG_GLOBAL})`,
    );
  }

  return freezeBag(raw as ProjectionConfigBag);
}

/** After {@link awaitProjectionConfig}; throws if not initialized. */
export function getProjectionConfig(): Readonly<ProjectionConfig> {
  if (cached === undefined) {
    throw new Error('ProjectionConfig not loaded — call awaitProjectionConfig() in bootstrap first');
  }
  return cached;
}

/** Test helper. */
export function clearProjectionConfigCache(): void {
  cached = undefined;
}
