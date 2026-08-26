/** Shared wire models — sidecar imports these to decode Virtual→host frames. */
export { NONE_DOM_NODE_KEY, type DomNodeKey } from './domNodeKey';
export { OpCode, opCodeName, NodeKind } from './opcodes';
export {
  ElementNs,
  ELEMENT_NS_HTML,
  ELEMENT_NS_SVG,
  ELEMENT_NS_MATHML,
  ELEMENT_NS_NESTED_HOST_BIT,
  classifyElementNs,
  elementNsUri,
  elementNsSnapshotLabel,
  packElementNsWireByte,
  unpackElementNsWireByte,
} from './elementNs';
export {
  FRAME_WIRE_VERSION,
  FRAME_PREFIX_BYTES,
  DOCUMENT_ID,
  CONTEXT_ID_ROOT,
  INSERT_AT_END,
  createFrame,
  type AttrPair,
  type EpochResetOp,
  type NodeNewOp,
  type InsertOp,
  type RemoveOp,
  type AttrSetOp,
  type AttrDelOp,
  type TextSetOp,
  type Frame,
  type FrameFlags,
  type FrameOp,
} from './frame';
export { ContextIdMint } from './contextIdMint';
export { isNestedHostNavAttr } from './nestedNav';
export {
  decodeFramePart,
  peekFrameHeader,
  FramePartAssembler,
  PersistentStringTable,
  type AssembledFrame,
  type DecodedFramePart,
  type PeekedFrameHeader,
  type DecodeError,
  type DecodeResult,
} from './decode';
export {
  TELEMETRY_WIRE_VERSION,
  DEFAULT_TELEMETRY_CONFIG,
  LAB_TELEMETRY_DEFAULTS,
  TELEMETRY_BOOL_CAPS,
  isProjectionTelemetryMessage,
  desyncPhase,
  type ProjectionTelemetryCapabilities,
  type ProjectionTelemetryConfig,
  type ProjectionTelemetryMessage,
  type TelemetryAggregate,
  type TelemetryApplyOverrun,
  type TelemetryApplyResult,
  type TelemetryClockStalled,
  type TelemetryDesynced,
  type TelemetryFrameEmitted,
  type TelemetryPhase,
  type TelemetryRateChanged,
  type TelemetryTransportDeferred,
} from './telemetry';
export {
  PlaneChannel,
  planeChannelName,
  PLANE_MAGIC,
  PLANE_VERSION,
  PLANE_HEADER_SIZE,
  encodePlaneEnvelope,
  decodePlaneEnvelope,
  isPlaneEnvelope,
  type PlaneEnvelope,
  type DataPlane,
  type DataPlaneResult,
  type DataPlaneMessageHandler,
  type LoopbackInvokeHandler,
  type LoopbackInvokeResult,
} from './plane';
export {
  VIRTUAL_LOOPBACK_CHANNEL,
  LOOPBACK_CONTROL_INVOKE_NAME,
  LOOPBACK_INVOKE_IDLE_MS,
  LOOPBACK_INVOKE_HEARTBEAT_MS,
  encodeLoopbackEnvelope,
  decodeLoopbackEnvelope,
  encodeLoopbackInvoke,
  encodeLoopbackInvokeResult,
  encodeLoopbackInvokeStarted,
  encodeLoopbackInvokeHeartbeat,
  encodeLoopbackFromPlane,
  decodeLoopbackToPlane,
  isLoopbackWireMessage,
  type LoopbackEnvelope,
  type LoopbackKind,
} from './loopback/envelope';
export {
  INTENT_SCHEMA_VERSION,
  normalizeDomInput,
  intentV2ToLegacy,
  type PageProjectionIntentV2,
  type DomInputIngress,
} from './input/intentTypes';
export { snapshotTree } from './snapshot/domTreeSnapshot';
export type { TreeNode } from './treeNode';
export { digestReplicatedTable, tableDigestsEqual, type ReplicatedTableDigest } from './tableDigest';
export { ReplicatedTable } from './replicatedTable';
export {
  applyOpsToTable,
  applyFrameToTableChecked,
} from './replicatedTableApply';
export type { TableLiveOracleResult } from './tableLiveOracle';
export { compareTableToLiveOrder } from './tableLiveOracle';
export type { CssomTableLiveOracleResult } from './cssomTableLiveOracle';
export { compareTableToLiveCssom } from './cssomTableLiveOracle';
export type { FormControlSnap } from './formControlSnap';
export { formControlSnapsEqual } from './formControlSnap';

