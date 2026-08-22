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
  type StrDefOp,
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
