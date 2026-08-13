/**
 * Projection telemetry wire messages (Virtual → sidecar on PlaneChannel.Telemetry;
 * lab client → session WS as `{ type: 'clientTelemetry' }`).
 *
 * Default-on facts stay frame-unit and cheap (E8). Decision / parity packs MUST
 * early-return before allocation when their capability is off.
 */

export const TELEMETRY_WIRE_VERSION = 1 as const;

/** Max childList decision rows in one `frameDecision` / apply note. */
export const CHILD_LIST_FACT_CAP = 32;

/** Capability toggles — disabled paths MUST early-return before allocation. */
export type ProjectionTelemetryCapabilities = {
  enabled: boolean;
  frameEmitted: boolean;
  transportDeferred: boolean;
  aggregate: boolean;
  establish: boolean;
  builderStats: boolean;
  applyResult: boolean;
  /** Client/Virtual desync — default on; failures must not be silent. */
  desync: boolean;
  applyOverrun: boolean;
  clock: boolean;
  /** Per-frame builder decisions (mode/existing/fresh/dirty). Debug pack. */
  frameDecision: boolean;
  /** Surface structure fingerprint after apply. Debug pack. */
  parityFingerprint: boolean;
  encoder: boolean;
  /** Establish → live publish table seed. Cheap, one event per load. */
  handoff: boolean;
};

export type ProjectionTelemetryConfig = ProjectionTelemetryCapabilities & {
  aggregateIntervalMs: number;
};

export const DEFAULT_TELEMETRY_CONFIG: ProjectionTelemetryConfig = {
  enabled: false,
  frameEmitted: true,
  transportDeferred: true,
  aggregate: true,
  establish: true,
  builderStats: true,
  applyResult: true,
  desync: true,
  applyOverrun: true,
  clock: true,
  frameDecision: false,
  parityFingerprint: false,
  encoder: false,
  handoff: true,
  aggregateIntervalMs: 10_000,
};

/** Lab inject / UI default — full decision pack on. */
export const LAB_TELEMETRY_DEFAULTS: ProjectionTelemetryConfig = {
  enabled: true,
  frameEmitted: true,
  transportDeferred: true,
  aggregate: true,
  establish: true,
  builderStats: true,
  applyResult: true,
  desync: true,
  applyOverrun: true,
  clock: true,
  frameDecision: true,
  parityFingerprint: true,
  encoder: true,
  handoff: true,
  aggregateIntervalMs: 2_000,
};

export const TELEMETRY_BOOL_CAPS: readonly (keyof ProjectionTelemetryCapabilities)[] = [
  'enabled',
  'frameEmitted',
  'transportDeferred',
  'aggregate',
  'establish',
  'builderStats',
  'applyResult',
  'desync',
  'applyOverrun',
  'clock',
  'frameDecision',
  'parityFingerprint',
  'encoder',
  'handoff',
];

export type DirtyCard = {
  newKeys: number;
  dirtyParents: number;
  attrDirty: number;
  textDirty: number;
  stateDirty: number;
  scrollDirty: number;
  detached: number;
};

export type ChildListDecisionFact = {
  parent: number;
  mode: 'full' | 'append';
  childCount: number;
  nExisting: number;
  nFresh: number;
  prevCount: number;
  /** `append` with no prior lastChildLists entry — establish-handoff smell. */
  appendFromEmpty: boolean;
};

export type TelemetryPhase =
  | 'decode'
  | 'assemble'
  | 'establish'
  | 'apply'
  | 'sequence'
  | 'generation'
  | 'clock'
  | 'encode'
  | 'handoff';

export type TelemetryFrameEmitted = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'frameEmitted';
  t: number;
  generation: number;
  sequence: number;
  opCount: number;
  partCount: number;
  bytes: number;
  establish?: boolean;
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
  partsAccepted: number;
  bytesAccepted: number;
  deferredCount: number;
  lastSequence: number;
};

export type TelemetryEstablishStarted = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'establishStarted';
  t: number;
  generation: number;
};

export type TelemetryEstablishCompleted = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'establishCompleted';
  t: number;
  generation: number;
  nodeCount: number;
  checksum: number;
  bytes: number;
  tableSize?: number;
};

export type TelemetryEstablishFailed = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'establishFailed';
  t: number;
  generation: number;
  message: string;
};

export type TelemetryBuilderStats = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'builderStats';
  t: number;
  generation: number;
  sequence: number;
  ephemeralPruned: number;
  absorbed: number;
  orphaned: number;
  opCounts: Record<string, number>;
};

export type TelemetryFrameDecision = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'frameDecision';
  t: number;
  generation: number;
  sequence: number;
  publishedCount: number;
  lastChildListsParents: number;
  lastChildListsEmpty: boolean;
  dirtyIn: DirtyCard;
  dirtyOut: DirtyCard;
  ephemeralPruned: number;
  absorbed: number;
  orphaned: number;
  childLists: ChildListDecisionFact[];
  childListsOmitted: number;
  patches: number;
  scrolls: number;
  appendFromEmptyCount: number;
};

export type TelemetryHandoff = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'handoff';
  t: number;
  generation: number;
  publishedCount: number;
  tableSize: number;
  lastChildListsSeeded: boolean;
  lastChildListsParents: number;
};

export type TelemetryEncoder = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'encoder';
  t: number;
  generation: number;
  sequence: number;
  partCount: number;
  bytes: number;
  maxFrameBytes: number;
  split: boolean;
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
  establish: boolean;
  reason?: string;
  nodeCount?: number;
  checksum?: number;
  registrySize?: number;
  appendOntoNonEmptyCount?: number;
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

export type TelemetryApplyDecision = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'applyDecision';
  t: number;
  generation: number;
  sequence: number;
  appendOntoNonEmptyCount: number;
  childLists: Array<{
    parent: number;
    mode: 'full' | 'append';
    nExisting: number;
    nFresh: number;
    parentChildCountBefore: number;
    appendOntoNonEmpty: boolean;
  }>;
  patches: number;
  scrolls: number;
};

export type TelemetryParityFingerprint = {
  v: typeof TELEMETRY_WIRE_VERSION;
  kind: 'parityFingerprint';
  t: number;
  generation: number;
  sequence: number;
  establish: boolean;
  registrySize: number;
  title: string;
  h1: string;
  bodyChildTags: string;
  anchorCount: number;
  scriptCount: number;
  pCount: number;
  htmlLen: number;
  duplicateTitle: boolean;
  duplicateH1: boolean;
};

export type ProjectionTelemetryMessage =
  | TelemetryFrameEmitted
  | TelemetryTransportDeferred
  | TelemetryAggregate
  | TelemetryEstablishStarted
  | TelemetryEstablishCompleted
  | TelemetryEstablishFailed
  | TelemetryBuilderStats
  | TelemetryFrameDecision
  | TelemetryHandoff
  | TelemetryEncoder
  | TelemetryClockStalled
  | TelemetryRateChanged
  | TelemetryApplyResult
  | TelemetryDesynced
  | TelemetryApplyOverrun
  | TelemetryApplyDecision
  | TelemetryParityFingerprint;

export function isProjectionTelemetryMessage(
  value: unknown,
): value is ProjectionTelemetryMessage {
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
    case 'establish_checksum':
      return 'establish';
    case 'sequence_gap':
      return 'sequence';
    case 'generation_mismatch':
      return 'generation';
    default:
      return 'apply';
  }
}

/** Concatenated-twice detector (`Lab fixtureLab fixture`). */
export function isRepeatedConcat(value: string): boolean {
  const t = value.trim();
  if (t.length < 4) return false;
  if (t.length % 2 !== 0) return false;
  const mid = t.length / 2;
  return t.slice(0, mid) === t.slice(mid);
}
