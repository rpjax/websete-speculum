/**
 * Click delivery — live-node resolve only (sparse-cdp).
 *
 * OS census-coordinated delivery was removed with the PP OS input stack
 * (decision-log.md 2026-08-27). Client hit-tests a nodeId; Virtual resolves the live
 * viewport point; EventApplier dispatches there. `nodeId == null` is handled by the
 * caller (raw-coordinate fallback), not this strategy.
 */

export type NodeResolveResult = { ok: boolean; x?: number; y?: number; reason?: string };

export type LiveNodeResolveClickDelivery = {
  readonly mode: 'live-node-resolve';
  resolveClickTarget(contextId: number, nodeId: number): Promise<NodeResolveResult>;
};

export type ClickDeliveryStrategy = LiveNodeResolveClickDelivery;

export function liveNodeResolveClickDelivery(
  resolveClickTarget: (contextId: number, nodeId: number) => Promise<NodeResolveResult>,
): LiveNodeResolveClickDelivery {
  return { mode: 'live-node-resolve', resolveClickTarget };
}
