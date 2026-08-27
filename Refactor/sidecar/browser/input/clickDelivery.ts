/**
 * Click delivery strategy — "how do I decide where to click", independent of
 * `IInputAdapter` ("how do I move the pointer once I know where"). Two adapter kinds
 * exist today and each pairs with exactly one strategy, but the pairing is a session-level
 * choice (see `PageProjectionBrowserSession.launch()`), not a property of the adapter
 * itself — nothing here mentions `os-abs`/`sparse-cdp` or Display/Chrome sequencing.
 *
 * - `census-coordinated` — sealed `os-abs` path (S6, LOCKED D-UI-26,
 *   [input.md](../../../../docs/page-projection/spec/input.md) §4): before every click, verify
 *   Projected's multi-context scroll state matches Virtual's. Fail ⇒ reject the click, never
 *   dispatch blind.
 * - `live-node-resolve` — `sparse-cdp` alternate pipeline
 *   ([input.md](../../../../docs/page-projection/spec/input.md) §2.1a, decision-log.md 2026-08-27):
 *   no census at all. The client already hit-tested a `nodeId` locally; resolve its live
 *   viewport point through Virtual and dispatch there. `nodeId == null` (hit-test miss) is
 *   handled by the caller (`EventApplier`), not this strategy.
 *
 * Replaces the previous loose optional pair `applyScrollCensus?` / `resolveClickTarget?` on
 * `EventApplierOptions` — those two fields were never meant to coexist (exactly one wired per
 * adapter kind), which a pair of independent optionals cannot express or enforce. A
 * discriminated union does: `EventApplier` takes exactly one `ClickDeliveryStrategy`, switches
 * on `.mode` exhaustively, and the compiler rejects a third mode landing without a handler.
 */

import type { ScrollCensus } from '@speculum/page-projection/core/input/unifiedIntentTypes';

export type CensusApplyResult = { ok: boolean; error?: string };
export type NodeResolveResult = { ok: boolean; x?: number; y?: number; reason?: string };

export type CensusCoordinatedClickDelivery = {
  readonly mode: 'census-coordinated';
  applyScrollCensus(census: ScrollCensus): Promise<CensusApplyResult>;
};

export type LiveNodeResolveClickDelivery = {
  readonly mode: 'live-node-resolve';
  resolveClickTarget(contextId: number, nodeId: number): Promise<NodeResolveResult>;
};

export type ClickDeliveryStrategy = CensusCoordinatedClickDelivery | LiveNodeResolveClickDelivery;

export function censusCoordinatedClickDelivery(
  applyScrollCensus: (census: ScrollCensus) => Promise<CensusApplyResult>,
): CensusCoordinatedClickDelivery {
  return { mode: 'census-coordinated', applyScrollCensus };
}

export function liveNodeResolveClickDelivery(
  resolveClickTarget: (contextId: number, nodeId: number) => Promise<NodeResolveResult>,
): LiveNodeResolveClickDelivery {
  return { mode: 'live-node-resolve', resolveClickTarget };
}
