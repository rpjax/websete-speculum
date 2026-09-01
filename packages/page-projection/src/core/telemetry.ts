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

import { OpCode } from './opcodes';
import type { FrameOp } from './frame';

export const TELEMETRY_WIRE_VERSION = 2 as const;

export type ProjectionTelemetryCapabilities = {
  enabled: boolean;
  frameEmitted: boolean;
  transportDeferred: boolean;
  aggregate: boolean;
  applyResult: boolean;
  desync: boolean;
  applyOverrun: boolean;
  clock: boolean;
  /** In-page CSSOM poll cost (investigation). Off unless lab injects it. */
  cssomPoll: boolean;
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
  cssomPoll: false,
  aggregateIntervalMs: 10_000,
};

/**
 * Lab inject / UI default.
 * `cssomPoll` stays off — at ~5 Hz it floods telemetry disk and steals Virtual time on live sites.
 * Turn on explicitly when investigating CSSOM poll cost.
 */
export const LAB_TELEMETRY_DEFAULTS: ProjectionTelemetryConfig = {
  enabled: true,
  frameEmitted: true,
  transportDeferred: true,
  aggregate: true,
  applyResult: true,
  desync: true,
  applyOverrun: true,
  clock: true,
  cssomPoll: false,
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
  'cssomPoll',
];

export type TelemetryPhase = 'decode' | 'assemble' | 'apply' | 'sequence' | 'generation' | 'clock' | 'encode';

export type TelemetryFrameEmitted = {
  v: typeof TELEMETRY_WIRE_VERSION;
  contextId: number;
  kind: 'frameEmitted';
  t: number;
  generation: number;
  sequence: number;
  opCount: number;
  partCount: number;
  bytes: number;
  /**
   * Replicated table row count (`ReplicatedTable.size`) after this frame's ops.
   * Detached rows remain until NODE_DROP. Diagnostic / time-series only — not an assert source.
   */
  tableSize: number;
  /** Identity-map size (`DomNodeTable`) — WeakRef, GC-sensitive. Diagnostic only. */
  identitySize?: number;
  buildMs: number;
  encodeMs: number;
};

export type TelemetryTransportDeferred = {
  v: typeof TELEMETRY_WIRE_VERSION;
  contextId: number;
  kind: 'transportDeferred';
  t: number;
  generation: number;
  sequence: number;
  pendingParts: number;
};

export type TelemetryAggregate = {
  v: typeof TELEMETRY_WIRE_VERSION;
  contextId: number;
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
  contextId: number;
  kind: 'clockStalled';
  t: number;
  sinceLastTickMs: number;
  rateHz: number;
};

export type CssomPollSource = 'idle' | 'resync' | 'snapshotScan';

/**
 * Producer CSSOM poll pass — time-series only; never an isomorphism assert (I10).
 * `pollMs` is wall time (includes waits between idle slices), not CSSOM CPU.
 */
export type CssomPollStats = {
  source: CssomPollSource;
  sequence: number;
  pollMs: number;
  identityWalkMs: number;
  cssTextSerializeMs: number;
  readableSheetCount: number;
  unreadableSheetCount: number;
  topLevelRulesVisited: number;
  topLevelRulesSerialized: number;
  styleTagTextUnchangedSheets: number;
  rulesAppeared: number;
  rulesDisappeared: number;
  rulesTextChangedInPlace: number;
  sheetsWithRuleListChanged: number;
  sheetsAborted: number;
  slotsSkipped: number;
  idleSlices: number;
  opCount: number;
  opSheetNew: number;
  opSheetDrop: number;
  opSheetOrder: number;
  opRuleNew: number;
  opRuleDrop: number;
  opRuleSet: number;
};

export type TelemetryCssomPoll = {
  v: typeof TELEMETRY_WIRE_VERSION;
  contextId: number;
  kind: 'cssomPoll';
  t: number;
} & CssomPollStats;

export const CSSOM_POLL_STAT_KEYS: readonly (keyof CssomPollStats)[] = [
  'source',
  'sequence',
  'pollMs',
  'identityWalkMs',
  'cssTextSerializeMs',
  'readableSheetCount',
  'unreadableSheetCount',
  'topLevelRulesVisited',
  'topLevelRulesSerialized',
  'styleTagTextUnchangedSheets',
  'rulesAppeared',
  'rulesDisappeared',
  'rulesTextChangedInPlace',
  'sheetsWithRuleListChanged',
  'sheetsAborted',
  'slotsSkipped',
  'idleSlices',
  'opCount',
  'opSheetNew',
  'opSheetDrop',
  'opSheetOrder',
  'opRuleNew',
  'opRuleDrop',
  'opRuleSet',
];

export function emptyCssomPollStats(): CssomPollStats {
  return {
    source: 'idle',
    sequence: 0,
    pollMs: 0,
    identityWalkMs: 0,
    cssTextSerializeMs: 0,
    readableSheetCount: 0,
    unreadableSheetCount: 0,
    topLevelRulesVisited: 0,
    topLevelRulesSerialized: 0,
    styleTagTextUnchangedSheets: 0,
    rulesAppeared: 0,
    rulesDisappeared: 0,
    rulesTextChangedInPlace: 0,
    sheetsWithRuleListChanged: 0,
    sheetsAborted: 0,
    slotsSkipped: 0,
    idleSlices: 0,
    opCount: 0,
    opSheetNew: 0,
    opSheetDrop: 0,
    opSheetOrder: 0,
    opRuleNew: 0,
    opRuleDrop: 0,
    opRuleSet: 0,
  };
}

export function countCssomOps(ops: readonly FrameOp[]): Pick<
  CssomPollStats,
  'opCount' | 'opSheetNew' | 'opSheetDrop' | 'opSheetOrder' | 'opRuleNew' | 'opRuleDrop' | 'opRuleSet'
> {
  let opSheetNew = 0;
  let opSheetDrop = 0;
  let opSheetOrder = 0;
  let opRuleNew = 0;
  let opRuleDrop = 0;
  let opRuleSet = 0;
  for (let i = 0; i < ops.length; i++) {
    switch (ops[i]!.op) {
      case OpCode.SheetNew:
        opSheetNew += 1;
        break;
      case OpCode.SheetDrop:
        opSheetDrop += 1;
        break;
      case OpCode.SheetOrder:
        opSheetOrder += 1;
        break;
      case OpCode.RuleNew:
        opRuleNew += 1;
        break;
      case OpCode.RuleDrop:
        opRuleDrop += 1;
        break;
      case OpCode.RuleSet:
        opRuleSet += 1;
        break;
      default:
        break;
    }
  }
  return {
    opCount: opSheetNew + opSheetDrop + opSheetOrder + opRuleNew + opRuleDrop + opRuleSet,
    opSheetNew,
    opSheetDrop,
    opSheetOrder,
    opRuleNew,
    opRuleDrop,
    opRuleSet,
  };
}

export function stampCssomPoll(stats: CssomPollStats, patch: Partial<CssomPollStats>): CssomPollStats {
  return { ...stats, ...patch };
}

export type TelemetryRateChanged = {
  v: typeof TELEMETRY_WIRE_VERSION;
  contextId: number;
  kind: 'rateChanged';
  t: number;
  fromHz: number;
  toHz: number;
  reason: 'hidden' | 'degrade' | 'recover' | 'config';
};

/** Lab client → session WS → re-broadcast as telemetry in Activity. */
export type TelemetryApplyResult = {
  v: typeof TELEMETRY_WIRE_VERSION;
  contextId: number;
  kind: 'applyResult';
  t: number;
  generation: number;
  sequence: number;
  ok: boolean;
  opCount: number;
  applyMs: number;
  /** Replicated table row count after apply. Time-series only — not an assert source. */
  tableSize: number;
  reason?: string;
};

export type TelemetryDesynced = {
  v: typeof TELEMETRY_WIRE_VERSION;
  contextId: number;
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
  contextId: number;
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
  contextId: number;
  kind: 'resyncRequested';
  t: number;
  generation: number;
  sequence: number;
  reason: string;
  attempt: number;
};

export type TelemetryResyncCompleted = {
  v: typeof TELEMETRY_WIRE_VERSION;
  contextId: number;
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
  contextId: number;
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
  | TelemetryCssomPoll
  | TelemetryApplyResult
  | TelemetryDesynced
  | TelemetryApplyOverrun
  | TelemetryResyncRequested
  | TelemetryResyncCompleted
  | TelemetryResyncFailed;

export function isProjectionTelemetryMessage(value: unknown): value is ProjectionTelemetryMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { v?: unknown; kind?: unknown; contextId?: unknown };
  if (v.v !== TELEMETRY_WIRE_VERSION || typeof v.kind !== 'string') return false;
  return typeof v.contextId === 'number' && Number.isInteger(v.contextId) && v.contextId >= 1;
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
