/**
 * PageProjection wire input types — input plane only (not frame ISA).
 */

export const INTENT_SCHEMA_VERSION = 1 as const;

/**
 * Flat wire-boundary DTO (gRPC `DomInputEvent` / hub `PageProjectionIntent`) — sidecar / gRPC
 * ingress, superset of legacy {@link BrowserSession.pushDomInput}. Distinct from `UnifiedIntent`
 * (`unifiedIntentTypes.ts`), the in-process type `EventApplier` actually consumes after the
 * `ingressToUnifiedIntent` conversion step; do not collapse the two.
 */
export type DomInputIngress = {
  type: string;
  anchor?: string | null;
  targetId?: number | null;
  /** V2 alias for {@link targetId}. */
  nodeId?: number | null;
  generation?: number;
  timestampClient?: number | null;
  wallClientMs?: number | null;
  payloadJson?: string;
  /** V2 alias for {@link payloadJson}. */
  payload?: string;
  contextId?: number;
  schemaVersion?: number;
  /** Unified pointer stamp (§10.6). */
  viewportW?: number | null;
  viewportH?: number | null;
  /** Scroll census JSON or object (PP down/up). */
  census?: string | null;
  x?: number;
  y?: number;
  /** Sparse-cdp click — fractions in target box [0,1] (also accepted via payload JSON). */
  localX?: number;
  localY?: number;
  key?: string;
  code?: string;
  scrollX?: number;
  scrollY?: number;
  button?: string | number;
};
