/**
 * Projection telemetry wire messages (Virtual → sidecar on PlaneChannel.Telemetry;
 * lab client → session WS as `{ type: 'clientTelemetry' }`).
 *
 * v0 note: this is a deliberately small schema focused on the thing this lab increment
 * exists to measure — per-frame build/encode/apply cost and op volume for the new
 * table-replicated algorithm (frame-protocol.md §5). The old establish / handoff /
 * frameDecision / append-mode / parityFingerprint-dup schema is gone with the concepts
 * it described (establish no longer exists — frame-protocol.md §4.7).
 */

export const TELEMETRY_WIRE_VERSION = 1 as const;

export type ProjectionTelemetryCapabilities = {
  enabled: boolean;
  frameEmitted: boolean;
  transportDeferred: boolean;
  aggregate: boolean;
  applyResult: boolean;
  desync: boolean;
  applyOverrun: boolean;
  clock: boolean;
};

export type ProjectionTelemetryConfig = ProjectionTelemetryCapabilities & {
  aggregateIntervalMs: number;
};

export const DEFAULT_TELEMETRY_CONFIG: ProjectionTelemetryConfig = {
  enabled: false,
  frameEmitted: true,
  transportDeferred: true,
  aggregate: true,
  applyResult: true,
  desync: true,
  applyOverrun: true,
  clock: true,
  aggregateIntervalMs: 10_000,
};

/** Lab inject / UI default — everything on. */
export const LAB_TELEMETRY_DEFAULTS: ProjectionTelemetryConfig = {
  enabled: true,
  frameEmitted: true,
  transportDeferred: true,
  aggregate: true,
  applyResult: true,
  desync: true,
  applyOverrun: true,
  clock: true,
  aggregateIntervalMs: 2_000,
};

export const TELEMETRY_BOOL_CAPS: readonly (keyof ProjectionTelemetryCapabilities)[] = [
  'enabled',
  'frameEmitted',
  'transportDeferred',
  'aggregate',
  'applyResult',
  'desync',
  'applyOverrun',
  'clock',
];

export type TelemetryPhase = 'decode' | 'assemble' | 'apply' | 'sequence' | 'generation' | 'clock' | 'encode';

export type TelemetryFrameEmitted = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'frameEmitted';
  t: number;
  generation: number;
  sequence: number;
  opCount: number;
  partCount: number;
  bytes: number;
  tableSize: number;
  buildMs: number;
  encodeMs: number;
};

export type TelemetryTransportDeferred = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'transportDeferred';
  t: number;
  generation: number;
  sequence: number;
  pendingParts: number;
};

export type TelemetryAggregate = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'aggregate';
  t: number;
  framesEmitted: number;
  opsEmitted: number;
  partsAccepted: number;
  bytesAccepted: number;
  deferredCount: number;
  lastSequence: number;
  avgBuildMs: number;
  avgEncodeMs: number;
};

export type TelemetryClockStalled = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'clockStalled';
  t: number;
  sinceLastTickMs: number;
  rateHz: number;
};

export type TelemetryRateChanged = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'rateChanged';
  t: number;
  fromHz: number;
  toHz: number;
  reason: 'hidden' | 'degrade' | 'recover' | 'config';
};

/** Lab client → session WS → re-broadcast as telemetry in Activity. */
export type TelemetryApplyResult = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'applyResult';
  t: number;
  generation: number;
  sequence: number;
  ok: boolean;
  opCount: number;
  applyMs: number;
  tableSize: number;
  reason?: string;
};

export type TelemetryDesynced = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'desynced';
  t: number;
  generation: number;
  sequence: number;
  errorCode: string;
  phase: TelemetryPhase;
  expectedSequence?: number;
  op?: string;
  id?: number;
  message?: string;
  /**
   * `errorCode: 'precondition'` (§6 phase-1 abort — `preTableHash` or `CHECK` mismatch,
   * frame-protocol-production-completeness Stage 2) — the table hashes that disagreed. `u64`
   * rides as a decimal string (`bigint` is not JSON-serializable).
   */
  expected?: string;
  actual?: string;
};

export type TelemetryApplyOverrun = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'applyOverrun';
  t: number;
  generation: number;
  sequence: number;
  durationMs: number;
  budgetMs: number;
};

/**
 * Stage 4 (frame-protocol-production-completeness) resync lifecycle — client → session WS →
 * re-broadcast, same path as `TelemetryApplyResult`/`TelemetryDesynced`. `generation`/`sequence`
 * are the client's own last-known-good values at request time (`resyncRequested`) or the
 * resync frame's own values (`resyncCompleted`/`resyncFailed`) — diagnostic only, never
 * load-bearing (the producer's `emitResyncFrame` always re-describes current truth regardless).
 */
export type TelemetryResyncRequested = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'resyncRequested';
  t: number;
  generation: number;
  sequence: number;
  reason: string;
  attempt: number;
};

export type TelemetryResyncCompleted = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'resyncCompleted';
  t: number;
  generation: number;
  sequence: number;
  attempt: number;
};

/**
 * A resync attempt failed — either no resync frame arrived before its own request timed out, or
 * the resync frame itself failed phase 1/2 (its own closing `CHECK` mismatched, an address miss
 * while materializing it, etc. — frame-protocol.md: "a resync frame whose closing CHECK fails is
 * a defect, not a recoverable state"). `exhausted: true` marks the last allowed attempt — the
 * client stops requesting further resyncs and the session stays permanently desynced, the
 * "catalogued hard failure, never a silent indefinite retry" this repo's engineering standards
 * require in place of an unbounded retry loop.
 */
export type TelemetryResyncFailed = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'resyncFailed';
  t: number;
  generation: number;
  sequence: number;
  attempt: number;
  reason: string;
  exhausted: boolean;
};

export type ProjectionTelemetryMessage =
  | TelemetryFrameEmitted
  | TelemetryTransportDeferred
  | TelemetryAggregate
  | TelemetryClockStalled
  | TelemetryRateChanged
  | TelemetryApplyResult
  | TelemetryDesynced
  | TelemetryApplyOverrun
  | TelemetryResyncRequested
  | TelemetryResyncCompleted
  | TelemetryResyncFailed;

export function isProjectionTelemetryMessage(value: unknown): value is ProjectionTelemetryMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { v?: unknown; kind?: unknown };
  return v.v === TELEMETRY_WIRE_VERSION && typeof v.kind === 'string';
}

export function desyncPhase(errorCode: string): TelemetryPhase {
  switch (errorCode) {
    case 'malformed':
    case 'unknown_version':
      return 'decode';
    case 'missing_part':
      return 'assemble';
    case 'sequence_gap':
      return 'sequence';
    case 'generation_mismatch':
      return 'generation';
    default:
      return 'apply';
  }
}
